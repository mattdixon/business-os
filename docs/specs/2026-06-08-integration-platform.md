# Integration Platform — Composio as the Connector Backbone

**Date:** 2026-06-08
**Status:** Locked decision. Do not re-litigate without explicit approval.
**Related:** [docs/specs/2026-06-06-business-os-architecture.md](2026-06-06-business-os-architecture.md)

---

## Context

The framework needs to integrate with dozens of third-party SaaS apps across many capability categories: email (Gmail, Outlook, IMAP), project management (Jira, ADO, Monday, Asana, ClickUp), CRM (Salesforce, HubSpot, GHL, Pipedrive), comms (Slack, Teams), storage (Drive, Dropbox, S3), calendar (Google, Microsoft), social (LinkedIn, Instagram), and more. Realistic catalog: 30+ providers across the first three clients, growing.

Per-provider direct OAuth integrations do not scale. Each provider requires:
- An OAuth app registration in their dev portal
- App verification (Google CASA assessment for restricted Gmail scopes; Microsoft admin consent flow; Salesforce app review)
- Ongoing maintenance as APIs and scopes drift
- Token refresh, revocation, and rate-limit handling

Maintaining 30+ such apps is months of work before the first agent ships value. We need an integration platform.

## Decision

**Composio is the default integration backbone.** All SaaS connectors are Composio-backed unless an explicit exception applies.

Composio chosen over Nango and Pipedream Connect because:
- 500+ pre-built toolkits covering nearly all expected providers
- Most AI-native — pre-typed actions agents can call directly
- Supports "custom auth configs" (BYO OAuth credentials) for white-labeled consent screens
- Reasonable pricing ($229/mo for 2M tool calls covers a portfolio of clients)
- Enterprise tier offers VPC/on-prem for clients that demand it

Trade-off accepted: on standard tiers, Composio holds the OAuth tokens. This is acceptable for the leadgen pilot and early clients. We negotiate self-host/BYO storage when portfolio revenue justifies enterprise pricing, or when a specific client's IT requires it.

## Architecture

The connector SDK interface does NOT change. Agents continue to call `ctx.connector(capability)` and receive a typed object. Composio is a hidden implementation detail.

```
agent → ctx.connector('email-inbox') → resolver → ComposioEmailConnector(provider: 'gmail')
                                                ↘ ImapEmailConnector
                                                ↘ <other direct connectors>
```

### Package layout

- `@frontrangesystems/business-os-connector-composio` — the generic Composio client wrapper. Owns the SDK init, auth-config handling, tool invocation, error mapping. NOT registered as a connector itself; it is the runtime substrate that other connectors are built on.
- `@frontrangesystems/business-os-connector-<capability>-<provider>` — thin per-provider, per-capability packages. Each one declares the capability it satisfies (`email-inbox`, `crm`, `project-management`) and delegates to `connector-composio`. Example: `@frontrangesystems/business-os-connector-email-gmail-composio` satisfies `email-inbox`.
- `@frontrangesystems/business-os-connector-<capability>-<provider>` (direct) — for non-Composio providers (e.g. `connector-email-imap`).

Both Composio-backed and direct connectors implement the same `@frontrangesystems/business-os-connector-sdk` interface. The framework does not care which is which.

### Auth modes per integration

Two modes, selectable per (client × provider):

**Managed mode** (default for v1):
- Composio's OAuth app
- End-user sees "Composio wants to access your <provider>" on consent
- Zero setup: register the connector, configure the connection, done
- Fastest. Right answer for the pilot and most internal-use cases

**Custom mode** (opt-in per client):
- We register an OAuth app in the provider's dev portal under the client's brand (or Business OS umbrella)
- Composio uses those credentials as the OAuth client
- End-user sees "<Client Name> wants to access..." on consent
- Required when: (a) client IT demands no third-party in the consent path, (b) higher-scope access is needed and we don't want to ride Composio's shared rate limits, (c) the client wants their own brand on the screen

The auth-config selection is a per-connector setting in the operator UI. Default is managed; operator switches a client to custom by entering their own OAuth client ID/secret.

### Token storage

- **Standard tiers:** tokens stored at Composio (encrypted at rest, scoped per Composio "entity")
- **Enterprise (future):** VPC/on-prem deployment of Composio backend; tokens in our infra
- **Local DB:** we store only the Composio entity ID + which auth-config the client picked. No raw tokens cross our boundary

This is a deliberate compromise of our "secrets in client DB" rule, limited to OAuth tokens for managed integrations. All other secrets (Anthropic keys, SMTP credentials, app config) remain in our DB per the locked architecture.

## Exceptions — when NOT to use Composio

Direct/custom connectors are required for:

1. **Protocol-level integrations:** IMAP/SMTP, raw S3-compatible storage, webhook receivers, JMAP. Composio is SaaS-API focused; it does not wrap protocols.
2. **Providers Composio does not support.** Verify before assuming; their catalog is large but not infinite. As of 2026-06-08, GoHighLevel and Azure DevOps need to be confirmed.
3. **Enterprise IT refuses third-party auth.** Likely rare in our segment (mid-market services) but expected at the largest accounts.
4. **System-level email** (password resets, framework notifications) — already locked to Postmark/Resend in core. Not a per-client connector.

## What this means for the email capability

The earlier "should email be Composio or direct" question dissolves:

- `email-inbox` capability: `@frontrangesystems/business-os-connector-email-gmail-composio`, `@frontrangesystems/business-os-connector-email-outlook-composio`, `@frontrangesystems/business-os-connector-email-imap` (direct, imapflow). Three connectors, one capability, operator picks per client.
- `email-transactional`: framework-owned, Postmark or Resend, no client config.
- `email-outreach` (cold sequences for leadgen): deferred. Likely a dedicated provider (Instantly, Smartlead, or a warmed SMTP pool) — not the same job as inbox access. Will get its own capability when leadgen needs it.

## Build plan

Sequence:
1. Lock this spec (this document).
2. Build `@frontrangesystems/business-os-connector-composio` — the generic wrapper. Init from `COMPOSIO_API_KEY` env var, surface `executeTool(toolkit, action, params)`, `createConnection(toolkit, entityId)`, error mapping.
3. Build `@frontrangesystems/business-os-connector-email-gmail-composio` — proof of pattern. Implements the `email-inbox` capability surface: `listMessages`, `getMessage`, `sendMessage`, `reply`, label/thread ops.
4. Wire one of the existing agents (likely leadgen) to depend on `email-inbox` via the connector resolver. End-to-end smoke test against a real Gmail account.
5. Once the pattern proves out, add `connector-email-outlook-composio` and `connector-email-imap` (direct). The capability now has three providers.
6. From here, every new SaaS integration follows the Composio pattern. Direct only when the exception list applies.

## Open questions to revisit

- BYO token storage on standard tiers — does Composio offer this, or is it enterprise-only? Confirm with sales before C&M goes to production.
- Cost projection at 10 clients × ~5 integrations each × N tool calls/day. Re-evaluate the $229 tier vs enterprise at that scale.
- Audit log: how do we record agent → Composio → provider calls in our audit log without leaking Composio internals? Likely: log the capability + action + outcome, not the Composio tool ID.
