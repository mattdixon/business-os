# Business OS Architecture (v2)

**Date:** 2026-06-06
**Supersedes:** [docs/archive/2026-05-multi-tenant-original/](../archive/2026-05-multi-tenant-original/)
**Status:** Locked architecture, scaffolding in progress

---

## Context

Original 2026-05 design assumed a multi-tenant SaaS (database-per-tenant, subdomain routing, control-plane DB). After the Lior Krolewicz Master Key OS workshop on 2026-06-05, the offering was reframed:

- High-ticket custom build per client ($500K+ engagements).
- One install per client. Their infrastructure, their database, their deployment.
- The product is a framework + a library of pluggable agents, not a hosted service.

Lior is a reference architect (his approach inspires ours). He is not a co-author. We build independently. If his Master Key platform reaches GA, we may license parts of it; until then, we own the stack.

## Goals

1. Ship a C&M Construction build in a reasonable timeline.
2. Make subsequent clients faster, not equally slow, by reusing the framework and shared agents.
3. Make framework upgrades cheap to roll out across N live clients.
4. Let clients diverge when they need to, without polluting the shared code.

## Non-goals

- Multi-tenancy of any kind.
- A SaaS product.
- A public marketplace.
- Visual workflow builder.

---

## The Hybrid A+B model

Two artifacts, both delivered together:

### A. Client starter template (the shell)

A thin per-client repo, scaffolded once via `pnpm create business-os-client <slug>`. Contains:

- `package.json` pinning `@frontrangesystems/business-os-*` versions.
- `business-os.config.ts` declaring which agents are enabled and which connectors are registered.
- `.env` template for framework-level secrets only (DB URL, `SECRETS_KEY`, system email API key).
- `deploy/` for client-specific deployment artifacts (Dockerfile, Fly/Render config).
- `agents/` empty — only client-custom agents live here.
- `migrations/` empty — only client-specific schema additions live here.

The shell is intentionally small. Most of it is config and glue. Framework code does NOT live here.

### B. Versioned framework + agent packages

Published to a private npm registry (GitHub Packages). Scope: `@frontrangesystems/business-os-*`.

- **Framework primitives** — `@frontrangesystems/business-os-core`, `@frontrangesystems/business-os-runtime`, `@frontrangesystems/business-os-db`, `@frontrangesystems/business-os-ui`, `@frontrangesystems/business-os-api-contract`.
- **SDKs** — `@frontrangesystems/business-os-agent-sdk`, `@frontrangesystems/business-os-connector-sdk`.
- **Shared agents** — `@frontrangesystems/business-os-agent-leadgen`, `@frontrangesystems/business-os-agent-prospecting`, `@frontrangesystems/business-os-agent-linkedin`, `@frontrangesystems/business-os-agent-instagram`, etc.
- **Shared connectors** — `@frontrangesystems/business-os-connector-gmail`, `@frontrangesystems/business-os-connector-ghl`, `@frontrangesystems/business-os-connector-openai`, etc.

Upgrades flow via `pnpm up`. Semver discipline is enforced.

### Why hybrid, not pure A or pure B

- Pure A (template only): client repos diverge, framework upgrades become per-client merge work. Painful at scale.
- Pure B (packages only): client shell has to exist somewhere; you can't avoid scaffolding the entry point.
- Hybrid: scaffold the entry point once (A), put the meat behind versions (B). Standard pattern — Next.js, Vite, Astro all work this way.

---

## The agent contract

This is the most important interface in the system. Get it right and everything composes; get it wrong and every agent is a special case.

```ts
import { z } from 'zod';
import type { AgentManifest, AgentContext, AgentResult } from '@frontrangesystems/business-os-agent-sdk';

export const manifest: AgentManifest = {
  slug: 'leadgen',
  version: '1.0.0',
  displayName: 'Lead Generation',
  description: 'Find new leads matching the client ICP and push to CRM.',
  requiredConnectors: ['email', 'crm', 'llm'],
  settingsSchema: z.object({
    icp_description: z.string().min(10),
    daily_lead_target: z.number().int().positive(),
    crm_tag: z.string().default('leadgen-inbound'),
  }),
  schedule: { kind: 'cron', expr: '0 */6 * * *' },
};

export async function run(ctx: AgentContext, input: unknown): Promise<AgentResult> {
  const crm = ctx.connector('crm');
  const llm = ctx.connector('llm');
  const { icp_description, daily_lead_target } = ctx.settings;

  ctx.logger.info({ daily_lead_target }, 'leadgen run starting');

  // ... do work ...

  return { ok: true, summary: 'pushed 12 leads', details: { leads: 12 } };
}
```

### What the framework gives the agent (`ctx`)

- `ctx.logger` — Pino child logger pre-tagged with `agent_slug`, `run_id`.
- `ctx.db` — Drizzle client scoped to the client's DB.
- `ctx.connector(capability)` — resolves the active connector for that capability from settings.
- `ctx.settings` — decrypted, parsed against `settingsSchema`, typed.
- `ctx.audit(action, meta)` — write to the framework audit log.
- `ctx.llm` — convenience wrapper around the active LLM connector with model defaults.
- `ctx.jobs.enqueue(name, payload, opts)` — schedule another job.

### What the agent owns

- Its own DB tables (declared via Drizzle schemas exported from the package).
- Its own migrations (run by the framework migration runner at boot).
- Its own settings schema.
- Optional API routes mounted at `/api/agents/<slug>/...` (declared in manifest).
- Optional UI panels (React components exported from the package, rendered by the operator UI).

---

## The connector contract

Capabilities are stable; providers are pluggable.

```ts
import type { ConnectorImpl, EmailCapability } from '@frontrangesystems/business-os-connector-sdk';

export const manifest = {
  slug: 'gmail',
  capability: 'email',
  version: '1.0.0',
  displayName: 'Gmail',
  authKind: 'oauth2',
  oauthConfig: { ... },
  settingsSchema: z.object({ ... }),
};

export const impl: ConnectorImpl<EmailCapability> = {
  async send(ctx, msg) { ... },
  async listInbox(ctx, opts) { ... },
  async getMessage(ctx, id) { ... },
};
```

The client's settings UI lists all registered providers per capability. The operator picks "Gmail" as the active email provider, completes OAuth, the framework stores encrypted tokens, agents transparently get Gmail when they ask for `'email'`.

---

## Runtime config — files vs DB

| What | Where | Why |
|---|---|---|
| Which agents are installed | `business-os.config.ts` (file) | Compile-time wiring. Code review catches changes. |
| Which connectors are registered | `business-os.config.ts` (file) | Same. |
| Agent enabled/disabled toggle | DB (settings UI) | Operator-facing. |
| Agent per-instance settings (ICP text, daily target) | DB (settings UI) | Operator-facing. |
| Cron schedule overrides | DB (settings UI) | Operator may tune cadence. |
| Connector credentials, OAuth tokens, API keys | DB encrypted | Secrets. Never in files. |
| Framework-level secrets (`DATABASE_URL`, `SECRETS_KEY`, system email key) | `.env` | Bootstrap chicken-and-egg — needed before DB is reachable. |

**Rule of thumb:** if a non-developer needs to change it, it's in the settings UI. If it's the bootstrap minimum to reach the DB, it's in `.env`. Nothing else goes in files.

---

## Migrations

- Framework core owns its migration table (`_bos_migrations`).
- Each agent owns its own migration table (`_bos_migrations_<agent_slug>`).
- All tables prefixed `bos_` (core) or `agent_<slug>_` (agent-owned). Reduces collision risk with anything the client adds later.
- Migration runner on boot: applies pending core migrations first, then each enabled agent's pending migrations in dependency order.

## Auth

- Server-side sessions, httpOnly cookie.
- Argon2id password hashing.
- Optional TOTP MFA per user.
- Password reset via single-use emailed token, 15-min TTL, sent via system email connector.
- No SSO, no magic links, no social login (out of scope).

## Logging & errors

- Pino structured JSON to stdout.
- Every line includes `client_slug` (from env), `request_id`, `user_id` (when known), `agent_slug` (when in an agent run), `run_id` (when in an agent run).
- Sentry for exceptions, tagged with the same.

## Background jobs

- pg-boss in the client's DB.
- Worker = same binary as API, run with `--worker` flag.
- Agent scheduled runs are pg-boss jobs.

---

## Build order (the smallest thing that proves the model)

1. `@frontrangesystems/business-os-agent-sdk` — define the interfaces. No implementation.
2. `@frontrangesystems/business-os-connector-sdk` — same.
3. `@frontrangesystems/business-os-core` minimal — Fastify boot, Drizzle wiring, settings table, audit log table, one health endpoint.
4. `@frontrangesystems/business-os-runtime` minimal — load a registry of agents, resolve `ctx.connector(cap)`, run an agent manually via CLI.
5. **One end-to-end agent: Lead Gen.** Real connector (start with one LLM and one CRM — `@frontrangesystems/business-os-connector-openai` and `@frontrangesystems/business-os-connector-ghl`). Make it work for C&M's actual use case.
6. Settings UI for the one agent + its connectors.
7. `templates/client-starter/` + `pnpm create business-os-client` — once we know what a real client repo needs.
8. THEN start generalizing — more agents, more connectors, the operator UI shell.

Don't design the whole framework in the abstract. The Lead Gen agent will reveal what the framework actually needs to be.

---

## Open questions

- npm registry: GitHub Packages under what org? (Probably make a new GH org `frontrange-systems` or `business-os`.)
- Deploy target for C&M: Fly.io, Render, bare VM? Affects what `deploy/` scaffolding looks like.
- LLM connector: which provider first — Anthropic, OpenAI, both?
- Settings UI hosting: same Fastify server serves it, or separate Vite app behind same auth?

Resolve before package scaffolding solidifies.
