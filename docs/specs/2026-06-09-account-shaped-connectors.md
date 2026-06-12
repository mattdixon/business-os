# Account-shaped connectors

**Status:** Draft — 2026-06-09
**Author:** Matt + Claude
**Supersedes:** the implicit "one connector package = one capability" assumption used in the first connector batch (email-gmail-composio, email-inbox-gmail-composio, email-inbox-outlook-composio, email-inbox-imap).

## Problem

Today each capability is a separate connector package, even when the underlying account is the same. Wiring up Gmail for an inbox-triage agent **and** a send agent means:

- Configure `email-inbox-gmail-composio` once (Composio link flow, store userId).
- Configure `email-gmail-composio` again (same userId, same flow, separate instance row).
- Same for IMAP — the operator would have to set host/user/password twice if/when an SMTP send adapter ships.

This breaks the operator's mental model ("I added my Gmail account") and multiplies config work as we add capabilities (calendar, contacts, drafts, etc).

Matt's framing (2026-06-09):
> "If I clinic to IMAP, I should be able to read, send to whatever. The agent would be the point where we want to decide what's possible. Otherwise, we'll end up configuring everything forever."

## Goal

One **Account** the operator configures once (creds + host/user/server, or Composio link). That account exposes **multiple capabilities** to the agent runtime. Agents still ask by capability — nothing changes on the agent contract.

## Non-goals

- Removing the capability layer. Capabilities are still the contract agents code against (locked in CLAUDE.md). We are NOT giving agents direct access to provider APIs.
- Multi-tenant routing or account sharing between clients. Single-tenant per install stays.
- Auto-discovery of capabilities. Each account package declares which capabilities it can expose; the operator chooses which to enable per account.

## Shape

### 1. Account package

A connector package is now an **Account**. It declares:

```ts
defineAccount({
  manifest: {
    slug: 'gmail',                  // unique per account package
    version: '1.0.0',
    displayName: 'Gmail',
    authKind: 'api-key',
    externalOAuth: { provider: 'composio', toolkit: 'gmail' },
    settingsSchema,                 // account-level: label, default folders, etc.
    capabilities: ['email-inbox', 'email'],   // declared support
  },
  // Optional cheap probe — used by Save & test on the account.
  verify(ctx) { ... },
  // One factory per capability the account exposes.
  adapters: {
    'email-inbox': (ctx) => makeInboxAdapter(ctx),
    'email':       (ctx) => makeSendAdapter(ctx),
  },
})
```

`ctx` is the same shape as today (credentials + settings + logger), shared across all adapters from the same account. Each adapter is a thin function that returns a capability impl — no second credential set, no second settings form.

### 2. Capability exposure (operator-visible toggle)

Per account instance, the operator can disable a specific capability. Default = all-on for capabilities the account declares.

Stored in the connector instance row as `exposed_capabilities: text[]`. The default is `account.manifest.capabilities`; the UI exposes a checkbox per capability so the operator can opt out (e.g. "this Gmail is for receiving only").

### 3. DB shape

`connector_instances` evolves:

```sql
ALTER TABLE connector_instances
  -- The account package slug. Was `provider_slug`; renamed for clarity.
  RENAME COLUMN provider_slug TO account_slug;
ALTER TABLE connector_instances
  -- Was "capability text" — a single capability per row. Now the row IS the
  -- account; the capabilities it exposes are a set.
  ADD COLUMN exposed_capabilities text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE connector_instances
  DROP COLUMN capability;
DROP INDEX connector_instances_capability_idx;
CREATE INDEX connector_instances_account_slug_idx
  ON connector_instances (account_slug);
CREATE INDEX connector_instances_exposed_capabilities_idx
  ON connector_instances USING GIN (exposed_capabilities);
```

Credentials and settings keep their existing scope key: `connector:<instance_id>` (no longer `connector:<capability>:<id>` — capability isn't a property of the credential anymore).

**Migration of existing rows:** for each old instance, set `account_slug = provider_slug` (the package slug, which post-refactor matches the account slug), set `exposed_capabilities = ARRAY[capability]`. Where two old instances both map to the same conceptual account (e.g. an IMAP host/user pair, or a Composio userId), they DO NOT auto-merge. Operator can delete the duplicate after the refactor lands. We document this in the migration changelog.

### 4. Resolver

`createConnectorResolver` becomes:

- Agent-scoped (`{ agentSlug }`) — agent bindings map `capability → instance_id` (unchanged). On resolve, the resolver loads the instance, confirms the requested capability is in `exposed_capabilities`, and looks up the registered Account's `adapters[capability]` factory.
- Default — first instance whose `exposed_capabilities` contains the capability and `is_active = true`.

Throws if:
- Bound instance no longer exposes the requested capability (clear error message — operator turned it off).
- No account in the registry matches `account_slug`.
- Account is in the registry but did not register an adapter for the requested capability.

### 5. Registry

`Registry.registerConnectorProvider` → `Registry.registerAccount`. The registry maps `accountSlug → AccountPackage`. `getAccount(slug)` returns the package; `listAccountsExposing(capability)` returns accounts whose manifest declares support for that capability. Adapters are pulled off the account at resolve time.

(We keep `registerMany` and `connectors-all` as the surface; semantics change but the call site doesn't.)

### 6. AddForm UX (UI)

`ConnectorsPage` reshapes around accounts:

- Top-level list is now "Accounts," grouped by `account_slug`. Each card shows which capabilities are exposed and which are off.
- Add flow:
  1. Pick the account type (Gmail, Outlook, IMAP, …) — filtered to accounts that support the capability the operator clicked "Add" from, but the picker also offers other types.
  2. Render `account.manifest.settingsSchema` as a form (the field we were missing for IMAP).
  3. Render credential UI (api-key paste, external-OAuth link, etc) — unchanged.
  4. Render checkbox group "Expose for:" with one box per declared capability, all on by default.
  5. Save & test — runs `account.verify(ctx)` once. No per-capability probing.

`SchemaForm` from the existing settings panel is reused inside AddForm.

### 7. Agent contract — unchanged

```ts
const inbox = ctx.connector('email-inbox');
const send  = ctx.connector('email');
```

Both can now resolve to the same underlying account. From the agent's perspective nothing changed.

## Implementation order

1. **connector-sdk** — add `AccountManifest`, `AccountPackage`, `defineAccount`, deprecate `defineConnector` (keep working as a thin wrapper that builds a single-capability account).
2. **db** — migration renaming `provider_slug` → `account_slug`, adding `exposed_capabilities`, dropping `capability`.
3. **runtime/registry + resolver** — switch to account-shaped lookup.
4. **connectors-all** — re-export updated account packages.
5. **Refactor `email-inbox-imap`** into account `imap` exposing `email-inbox` and `email` (IMAP for read, SMTP for send — needs SMTP fields added to settings).
6. **Merge `email-gmail-composio` + `email-inbox-gmail-composio`** into account `gmail-composio` exposing both capabilities.
7. **Merge `email-inbox-outlook-composio`** into account `outlook-composio` exposing `email-inbox` (later `email` when send adapter lands).
8. **AddForm + ConnectorsPage UI**.
9. **API contract** — `/api/connectors` list/instance shapes; update Zod schemas in `@frontrangesystems/business-os-api-contract`.
10. **Tests** — vitest integration: create IMAP account, resolve email-inbox and email from it, agent gets both.

## Risks / open questions

- **Adapter loading cost.** Each adapter is constructed per resolve call today. If an agent grabs `email-inbox` and `email` in the same run, we instantiate the account's internals twice. Acceptable for now (matches current behavior); revisit if/when we see real cost.
- **Naming.** "Account" overloads with the OS-level User/account concept. Considered "Connection" but that overloads with Composio. Sticking with Account — it's the operator-facing word.
- **Verify cost.** For Composio accounts, verify is a cheap entity lookup. For IMAP, verify is a connect+LOGIN. For SMTP, EHLO is enough. Fine.
- **Existing `defineConnector` packages.** Wrap them on read so we don't have to refactor `connector-anthropic`, `connector-openai`, `connector-composio` (substrate, not an email account), etc. They keep working as single-capability accounts.
