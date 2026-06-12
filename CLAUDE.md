# CLAUDE.md — Business OS

Read this first. Captures durable conventions and locked decisions. **Don't re-litigate decisions listed here without explicit user approval.**

---

## What this project is

A framework and a library of pluggable agents that we install **once per client** as a custom operating system. Each client gets their own deployment, their own database, their own infra. This is a high-ticket professional services build ($500K+ engagements), not a SaaS.

**First client:** C&M Construction (concrete).

**Inspiration:** Lior Krolewicz's Master Key OS workshop (2026-06-05). Lior is a reference architect, not a co-author. We're building this independently.

## Shipping model — Hybrid A+B

We ship two things:

1. **Framework + agent library** — versioned npm packages under `@frontrangesystems/business-os-*`. Published to a private registry (GitHub Packages). Each client install pins versions. Bug fixes flow via `pnpm up`.
2. **Client starter template** — a thin shell scaffolded once per client via `pnpm create business-os-client <name>`. The shell contains: `package.json` with versioned framework deps, a config file declaring which agents are enabled, env template, deploy scripts, and a place for client-custom agents.

**Per-client install is one repo per client.** Their repo is small (the shell). The framework code lives in the versioned packages, not in their tree.

---

## Locked technical decisions (do NOT re-litigate without user approval)

| Area | Decision |
|---|---|
| **Tenancy** | **Single-tenant per install.** No multi-tenant routing, no control-plane DB, no tenant registry. Each client = one deployment + one DB. |
| **Distribution** | **Hybrid A+B.** Thin starter shell per client (scaffolded once), versioned `@frontrangesystems/business-os-*` packages for framework and shared agents. |
| **Registry** | Private npm registry (GitHub Packages under whatever GH org we land on). |
| **Identity** | Server-side sessions + httpOnly cookie. Argon2id passwords. TOTP MFA optional. Users live in the client's own DB. |
| **API style** | REST + JSON. Fastify + Zod + OpenAPI. OpenAPI doc is the contract for web + mobile + 3rd party. |
| **Monorepo** | pnpm workspaces + Turborepo. |
| **ORM** | Drizzle. Core schema in `@frontrangesystems/business-os-core`. Each agent owns its own migrations. |
| **Auth** | Server-side sessions, Argon2id, optional TOTP. Password reset via single-use emailed token (15-min TTL). |
| **Agent registration** | Static registry in the client shell's `business-os.config.ts`. Agents are imported by name and the framework wires them up at boot. |
| **Connector registration** | Every framework connector is registered automatically via `@frontrangesystems/business-os-connectors-all` (the client shell calls `registry.registerMany(allFrameworkConnectors)`). The operator decides which providers are *visible* in the Add Instance dropdown via the **Providers** admin page — disabled providers stay registered (existing instances keep working) but don't appear for new instance creation. Client-custom connectors still register explicitly. |
| **Agent runtime** | Each agent declares a `manifest` (slug, version, required connectors, settings schema, schedule) and a `run(ctx, input)` function. Framework boots them, schedules them, gives them ctx (logger, db, connectors, settings, audit log). |
| **Connectors** | Per-capability interfaces, pluggable providers. Agents call `ctx.connector('email')` — never name a provider. Multiple providers per capability allowed; client picks in settings UI. |
| **Runtime config** | **All credentials, API keys, schedules, on/off, and per-agent settings live in the DB and are managed in the settings UI.** Files declare *what* is installed, NOT secrets or runtime values. Each agent declares a settings Zod schema; framework auto-renders the form. |
| **Secrets** | libsodium `crypto_secretbox` at rest in the DB. Key from env (`SECRETS_KEY`). |
| **Background jobs** | pg-boss in the client's DB. Worker is the same binary as the API with `--worker` flag. |
| **System email** | Postmark or Resend (transactional from the framework — password resets etc.), distinct from per-client email connectors agents use. |
| **Logging** | Pino structured JSON. Every line includes `client_slug`, `request_id`, `user_id`, `agent_slug` (when relevant). |
| **Errors** | Sentry, tagged with `client_slug` and `agent_slug`. |
| **Migrations** | Forward-only. Core owns its migration table; each agent owns its own. Framework runs all on boot or via CLI. |
| **Testing** | Vitest. Integration tests hit real Postgres in Docker — no DB mocks. |
| **Code style** | TypeScript strict. ESM. No `any` in committed code. |

---

## Repo layout

```
business-os/                              ← this repo (the framework monorepo)
├── packages/
│   ├── core/                  @frontrangesystems/business-os-core           # Fastify server, auth, users, audit, settings, deploy primitives
│   ├── runtime/               @frontrangesystems/business-os-runtime        # Agent runtime: scheduler, ctx, connector resolver, manifest loader
│   ├── agent-sdk/             @frontrangesystems/business-os-agent-sdk      # The interface every agent implements + helpers
│   ├── connector-sdk/         @frontrangesystems/business-os-connector-sdk  # The interface every connector implements + capability types
│   ├── db/                    @frontrangesystems/business-os-db             # Drizzle base schema + migration runner
│   ├── ui/                    @frontrangesystems/business-os-ui             # Shared React components (operator UI shell, settings forms)
│   └── api-contract/          @frontrangesystems/business-os-api-contract   # Zod schemas + generated OpenAPI types
├── agents/                                                # Shared agent library — each is its own published package
│   ├── leadgen/               @frontrangesystems/business-os-agent-leadgen
│   ├── prospecting/           @frontrangesystems/business-os-agent-prospecting
│   ├── linkedin/              @frontrangesystems/business-os-agent-linkedin
│   └── instagram/             @frontrangesystems/business-os-agent-instagram
├── connectors/                                            # Shared connector library — each is its own published package
│   ├── gmail/                 @frontrangesystems/business-os-connector-gmail
│   ├── ghl/                   @frontrangesystems/business-os-connector-ghl
│   ├── linkedin/              @frontrangesystems/business-os-connector-linkedin
│   └── openai/                @frontrangesystems/business-os-connector-openai
├── templates/
│   └── client-starter/                                    # The thin shell every client repo starts from
├── tools/
│   └── create-client/         @frontrangesystems/business-os-create-client  # `pnpm create business-os-client <name>` scaffolder
└── docs/
    ├── prd/                                               # Product requirements
    ├── specs/                                             # Technical design docs
    └── archive/                                           # Superseded designs
```

### What a client repo looks like (NOT in this monorepo — scaffolded separately per client)

```
c-and-m-construction-os/
├── package.json               # depends on @frontrangesystems/business-os-core + agents + connectors at pinned versions
├── business-os.config.ts      # registry: which agents enabled, which connectors registered, default schedules
├── .env                       # framework-level secrets (DB URL, SECRETS_KEY, system email API key)
├── agents/                    # ONLY client-custom agents live here
├── migrations/                # ONLY client-specific schema additions
└── deploy/                    # client-specific deploy config (Dockerfile, fly.toml, etc.)
```

### Boundary rules

- Framework packages (`packages/*`) MUST NOT import from any agent or connector package — only SDK interfaces.
- Agents MUST NOT import from other agents.
- Agents may import `@frontrangesystems/business-os-agent-sdk` and `@frontrangesystems/business-os-connector-sdk` types.
- Connectors implement `@frontrangesystems/business-os-connector-sdk` interfaces and nothing else from the framework.
- Client shells may import any `@frontrangesystems/business-os-*` package.

---

## The agent contract (the most important interface in the system)

Every agent exports:

```ts
export const manifest: AgentManifest = {
  slug: 'leadgen',
  version: '1.0.0',
  displayName: 'Lead Generation',
  requiredConnectors: ['email', 'crm'],
  settingsSchema: z.object({ ... }),     // rendered by framework as a settings form
  schedule: { kind: 'cron', expr: '0 */6 * * *' } | { kind: 'manual' } | { kind: 'event', topic: '...' },
};

export async function run(ctx: AgentContext, input: unknown): Promise<AgentResult> {
  const email = ctx.connector('email');
  const settings = ctx.settings;
  ctx.logger.info('starting');
  ...
}
```

`ctx` gives the agent: logger, db (scoped), connectors (resolved by capability), settings (decrypted at runtime), audit log helper, and the framework's standard tools (LLM client, scheduling, etc).

When a client wants custom behavior: **either** add a config knob to the shared agent (preferred), **or** fork into `agents/leadgen-cm/` in their repo and now it's theirs.

---

## Runtime config rules

- Files in the client repo declare WHAT is installed and the code-level shape.
- DB + Settings UI store WHAT changes at runtime: credentials, API keys, schedules, on/off, per-agent settings.
- Secrets encrypted at rest with libsodium. Key from `SECRETS_KEY` env var.
- New connector for Gmail? Operator clicks "Add Gmail account" in settings → OAuth flow → tokens encrypted into DB. No file changes.
- New API key for Claude? Operator pastes it into settings UI. No file changes.

If you find yourself writing "put it in `.env`" or "edit the config file" for anything user-facing, stop. That goes in the settings UI.

---

## Conventions

### Audit log
- Every state-changing API call MUST result in an audit-log row. Use the audit-log helper; don't write rows directly.
- Audit-log rows contain `request_id` for log correlation.

### Connectors
- Agents ask for connectors by capability (`'file-storage'`, `'email'`, `'llm'`), never by provider name.
- Connector implementations MUST NOT log raw tokens or full payloads.
- A connector capability can have multiple registered providers; the client picks which one is active in settings.

### Schemas
- API request/response shapes in `@frontrangesystems/business-os-api-contract`.
- Drizzle schemas: core in `@frontrangesystems/business-os-db`, agent-owned tables in the agent's own package.
- Migrations colocate with the schema that owns them.

### Tests
- Every new endpoint gets at least one integration test against a real Postgres.
- Every agent has a `run` test with stubbed connectors.

---

## Saving work

Persist progress continuously. Lost a session to a crash once — don't repeat that.
- Write decisions to docs/ as you make them.
- Commit to git after each meaningful section.
- Update memory files when learning facts; don't batch.

### Git
- Conventional commits: `Spec: ...`, `Feat: ...`, `Fix: ...`, `Chore: ...`.
- Don't squash exploratory work.

---

## Per-client work

When implementing for a specific client:
1. First ask: "Is this generic (framework/shared agent) or client-specific (their shell)?" Framework stays business-agnostic.
2. Client-custom agents in the client repo may have hard-coded domain logic. Framework and shared agents may not.
3. If a feature *feels* generic but is requested by one client: design a config knob on the shared agent, put the policy in the client's settings.

---

## Out of scope (don't build unless asked)

- Multi-tenant routing of any kind.
- Self-service signup or client provisioning UI.
- In-platform billing.
- Public marketplace for 3rd-party agents.
- Visual workflow builder, low-code UI.
- Native mobile app (PWA covers it).
- SSO/SAML, social login, magic links (TOTP MFA is enough).

---

## Useful CLIs (planned — document when implemented)

- `pnpm create business-os-client <name>` — scaffold a new client shell repo.
- `pnpm migrate` (inside client repo) — apply pending migrations across framework + agents.
- `pnpm dev` (inside client repo) — start API + worker + web.
- `pnpm test` (here in the framework monorepo) — run all framework + agent + connector tests.

---

## When in doubt

- Ask before adding a dependency that isn't already in the spec.
- Ask before introducing a new top-level package.
- Ask before changing anything in the "Locked technical decisions" table above.
- Default to building the smallest piece that proves the agent contract. Don't design the whole framework in the abstract — build one agent end-to-end (Lead Gen) and let it pull the framework into shape.

---

## Telegram channel responses

When responding to messages from the Telegram channel (any `<channel source="plugin:telegram:telegram" ...>` message):

- **Never use AskUserQuestion, ExitPlanMode, or any other interactive-selection tool.** Those render only in the local TUI. The Telegram channel plugin does not forward them to Telegram, so the sender sees silence and the session parks indefinitely waiting for a local keystroke.
- If you need to ask a clarifying question, send it as a plain text Telegram reply via the channel's `reply` tool. The sender will reply with another message.
- If you would normally present numbered options, write them as numbered text in the reply body instead.

**Acknowledge immediately**
- Within the first action after receiving a channel message, add a react (👀 or 🔥) so Matt knows the message landed. Then proceed to read context and respond.
- The react is your heartbeat. It prevents the "is the bot stuck?" feedback loop while you're still gathering context.

**Long-running work — send progress**
- If a task will take more than about 60 seconds of tool calls, send a brief reply first ("Working on it, will report back") so Matt knows you're alive.
- For multi-step jobs, use `edit_message` to update that progress reply instead of sending a new message each step. edit_message doesn't trigger push notifications, so Matt's phone won't ping repeatedly.
- When the job completes, send a NEW reply (not an edit). New replies trigger notifications — that's how he knows it's done and can look.
- If you're mid-subagent when a new message arrives, send a quick reply acknowledging the new request and stating whether you'll finish the current task first or interrupt. Don't let inbound messages sit unacknowledged behind a long-running task.
