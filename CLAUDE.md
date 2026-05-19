# CLAUDE.md — Business OS

Read this first. It captures durable conventions, locked decisions, and where things live. **Don't re-litigate decisions listed here without explicit user approval.**

---

## What this project is

A multi-tenant platform that runs many independent client businesses from one codebase. Generic core ("framework") + per-client module packs ("clients/"). API-first so web, mobile, and agents share the same endpoints.

**First client:** CNN Construction (concrete). See [docs/prd/2026-05-19-cnn-construction-client-prd.md](docs/prd/2026-05-19-cnn-construction-client-prd.md).

## Authoritative documents (read order)

1. [docs/prd/2026-05-19-business-os-framework-prd.md](docs/prd/2026-05-19-business-os-framework-prd.md) — what we're building and why (framework)
2. [docs/prd/2026-05-19-cnn-construction-client-prd.md](docs/prd/2026-05-19-cnn-construction-client-prd.md) — first client requirements
3. [docs/superpowers/specs/2026-05-19-business-os-foundation-design.md](docs/superpowers/specs/2026-05-19-business-os-foundation-design.md) — technical design (the "how")
4. This file — conventions and locked decisions

If a PRD and the spec conflict, the spec wins (it's the more recent, lower-level document). Flag the conflict.

---

## Locked technical decisions (do NOT re-litigate without user approval)

| Area | Decision |
|---|---|
| Tenancy | **Database-per-tenant.** Each client gets their own Postgres DB. Control-plane DB holds tenant registry + operator users only. |
| Identity | **No central users table.** Users, sessions, password hashes all live in each tenant DB. |
| Routing | **Subdomain per tenant.** `<slug>.businessos.app`. Tenant resolved from `Host` header before auth. |
| API style | **REST + JSON.** Fastify + Zod + OpenAPI. OpenAPI doc is the contract for all clients (web + future mobile + 3rd party). |
| Monorepo | **pnpm workspaces + Turborepo.** |
| ORM | **Drizzle.** Schema lives in `packages/db`. |
| Auth | **Server-side sessions + httpOnly cookie.** Argon2id passwords. TOTP MFA optional per user. Password reset by emailed single-use token (15-min TTL). |
| Extensibility | **Static plugin registry.** Per-client modules are TS packages in `clients/<slug>/`, compiled into the API binary. Enabled per tenant via control-plane config. |
| Connectors | **Per-type interfaces, pluggable providers.** Modules call `getConnector('file-storage')` — never name a provider. |
| Background jobs | **pg-boss.** Jobs live in each tenant DB. Worker is the same binary as the API with `--worker` flag. |
| System email | **Postmark or Resend** (single transactional-email provider, separate from per-tenant email connectors). |
| Logging | **Pino** structured JSON. Every log line includes `tenant_slug`, `tenant_id`, `request_id`, `user_id` when known. |
| Errors | **Sentry**, tagged with `tenant_slug` and `module_slug`. |
| Encryption | **libsodium `crypto_secretbox`** for OAuth tokens, tenant DB passwords, MFA secrets. Key from env. |
| Migrations | Forward-only. Per-tenant migration table tracks applied migrations. Migration runner CLI iterates tenants. |
| Testing | **Vitest.** Integration tests hit a real Postgres in Docker — no DB mocks. |
| Code style | TypeScript strict. ESM. No `any` in committed code. |

---

## Repo layout

```
business-os/
├── apps/
│   ├── api/             # Fastify server (the only deployed backend; also runs as worker with --worker)
│   ├── web/             # React admin/operator UI
│   └── web-tenant/      # React tenant-facing UI (may merge with web later)
├── packages/
│   ├── db/              # Drizzle schemas (control-plane + tenant) + migration runner
│   ├── core/            # Domain services (auth, users, files, audit, notifications)
│   ├── connectors/      # Connector framework + built-in providers
│   ├── module-sdk/      # Public API surface that per-client modules build against
│   ├── api-contract/    # Zod schemas + generated OpenAPI types
│   └── ui/              # Shared React components
├── clients/
│   └── cnn-construction/  # CNN's module pack (Prospector, Proposal automation)
├── tools/                 # CLIs: tenant provisioning, migrations
└── docs/
    ├── prd/               # Product requirements
    └── superpowers/specs/ # Technical design docs
```

### Boundary rules
- `apps/api` may import from any `packages/*` and any `clients/*` pack.
- `packages/core`, `packages/db`, `packages/connectors`, `packages/module-sdk` may NOT import from `clients/*`.
- A `clients/<slug>/` pack may import from `packages/*` (especially `module-sdk`) but **MUST NOT** import from another `clients/<slug2>/` pack.
- `packages/api-contract` is the only place where API request/response shapes are defined.

Enforce with `eslint-plugin-boundaries` or equivalent.

---

## Conventions

### File operations
- Never write code that touches a tenant DB without going through the tenant resolver. There must be a `req.tenant` (request path) or an explicit `withTenant(tenantId, fn)` (job/CLI path) — no ad-hoc tenant DB lookups in business logic.
- Never store user data in the control-plane DB.

### Naming
- Tenant slugs: lowercase ASCII, hyphens allowed, used in subdomain and DB name (`tenant_<slug>`).
- Module slugs: same constraints; declared in the module's `slug` field.
- API routes: core routes under `/api/...`, module routes under `/api/m/<module-slug>/...`.

### Audit log
- Every state-changing API call MUST result in an audit-log row. Use the audit-log helper; don't write rows directly.
- Audit-log rows contain `request_id` so they correlate with logs.

### Connectors
- A module asks for a connector by capability (`'file-storage'`, `'email'`), never by provider name.
- A connector implementation MUST NOT log raw tokens or full payloads.

### Schemas
- Add Zod schemas to `packages/api-contract`. Server validates with them; client gets types from them.
- Drizzle schemas in `packages/db`. The migration to add/change a table goes in the same PR.

### Tests
- Every new endpoint gets at least one integration test.
- Cross-tenant isolation has dedicated tests — when adding any new endpoint that reads tenant data, add a test that two tenants don't see each other.

---

## Operational conventions

### Saving work
This project lost a session to a crash. **Persist progress continuously:**
- Write decisions to docs/ as you make them
- Commit to git after each meaningful section (small frequent commits are fine)
- Update memory files when learning facts; don't batch

### Git
- Conventional-ish commits: `Spec: ...`, `Feat: ...`, `Fix: ...`, `Chore: ...`
- Don't squash exploratory work; the small commits are useful history

### Per-client work
When implementing for a specific client:
1. First, ask: "Is this generic (core) or client-specific (their pack)?" Core stays business-agnostic.
2. Client packs may have hard-coded domain logic. Core may not.
3. If a feature *feels* generic but is being requested by one client, design the interface in core and put the policy in the pack.

---

## Out of scope (don't build unless asked)

- Native mobile app (PWA covers it for now)
- SSO/SAML, social login, magic links
- Self-service tenant signup
- Multi-region deployment
- In-platform billing
- Marketplace / third-party modules
- Visual workflow builder, low-code

---

## Useful CLIs (planned)

These don't exist yet; document them when implemented.

- `pnpm tenant:create --slug <slug> --name <name>` — provision new tenant
- `pnpm tenant:migrate <slug>` — apply pending migrations to a tenant
- `pnpm tenant:migrate-all` — apply pending migrations across all tenants
- `pnpm tenant:enable-module <slug> <module-slug>` — enable a module for a tenant
- `pnpm dev` — start API + web in dev mode
- `pnpm test` — run all tests (requires Docker for Postgres)

---

## When in doubt
- Ask the user before adding a dependency that wasn't already in the spec.
- Ask before introducing a new top-level package or app.
- Ask before changing anything in the "Locked technical decisions" table above.
