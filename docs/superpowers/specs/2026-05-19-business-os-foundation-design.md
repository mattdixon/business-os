# Business OS — Foundation Design

**Status:** Draft — awaiting user review
**Date:** 2026-05-19
**Scope:** Core platform foundation. Per-client modules, mobile client, and admin UI are separate specs.

---

## 1. Purpose

A multi-tenant Business OS platform that serves multiple client businesses from one codebase. Generic core + per-client implementation layer. API-first so web, mobile (PWA or native), and agents can all consume the same secured endpoints.

**First client:** CNN Construction (concrete company; needs Prospector and Proposal-automation modules; uses Dropbox).

---

## 2. Decisions Locked

### 2.1 Tenancy: Database-per-tenant

Each client gets their own Postgres database. A platform-level "control plane" database stores only cross-tenant metadata: the tenant registry, per-tenant module configuration, operator (your own staff) accounts, and billing. User identities for tenant users live inside each tenant DB (§2.2), not here.

**Why:**
- Strongest isolation — a bug in core can't leak data across clients
- No Row-Level Security policies to get wrong
- Easy "export this client's data" / "delete this client" operations
- Clear compliance story per client

**Costs we accept:**
- Migrations must run across N databases (need a migration runner)
- Connection pooling needs per-tenant routing (PgBouncer or app-level pool-per-tenant with caps)
- Provisioning a new client = provision a new DB

**Open items for later sections:** migration strategy, pooling strategy, provisioning automation.

### 2.2 Identity: Users live only inside each tenant DB

No central users table. Each tenant DB owns its own `users`, `sessions`, `roles`, etc. The control-plane DB holds **only**: tenant registry, billing, routing metadata, provisioning state.

**Implications (accepted):**
- A human working with multiple clients has separate accounts per client
- Operator/support access uses a dedicated mechanism (e.g., a provisioned admin user per tenant, or a control-plane-only ops console that connects to tenant DBs with elevated credentials) — designed in a later section
- Request routing must identify the tenant *before* auth runs, so the API knows which DB to authenticate against

**Why:**
- Maximum data isolation — auth data is tenant data, never crosses tenants
- Simpler mental model: one tenant DB = one self-contained business system
- "Delete this client" stays a single-DB operation

### 2.3 Tenant routing: Subdomain per tenant

URL pattern: `<tenant-slug>.businessos.app` (e.g. `cnn.businessos.app`). Tenant is inferred from the `Host` header on every request. Mobile clients store the subdomain at first-run setup.

**Implications (accepted):**
- Need wildcard DNS (`*.businessos.app`)
- Need wildcard TLS certificate (Let's Encrypt wildcard via DNS-01 challenge, or use a platform that handles this — Cloudflare, Fly, Render, Vercel for the frontend)
- A control-plane host (e.g. `admin.businessos.app` or `app.businessos.app`) for operator-only tooling and tenant provisioning
- Each incoming request flow: parse subdomain → look up tenant in control-plane → get tenant DB connection → run auth against tenant DB → run handler

**Open items:** how to keep control-plane lookups fast (cache tenant→DB mapping in memory with TTL invalidation).

### 2.4 API framework: Fastify + Zod + OpenAPI

REST + JSON. Fastify for the HTTP server, Zod for runtime request/response validation, `@fastify/swagger` (or `fastify-zod-openapi`) for auto-generated OpenAPI 3 spec. Frontend and any future mobile client consume a typed client generated from the OpenAPI document.

**Why:**
- Framework-agnostic wire format: web, PWA, React Native, native iOS/Android, and third-party integrators all consume the same REST API
- Zod gives us one schema definition that drives validation, types, and OpenAPI docs
- No lock-in: the API contract lives in OpenAPI, not in a TS-only client library
- Per-tenant DB routing is easy to add as a Fastify plugin (`req.tenant` populated by hostname-parsing hook before auth)

**Implications:**
- Slightly more codegen ceremony than tRPC, but worth it for mobile portability
- Need a code-generation step in CI to keep the typed client in sync (e.g. `openapi-typescript` or `orval`)

### 2.5 Monorepo: pnpm workspaces + Turborepo

```
business-os/
├── apps/
│   ├── api/             # Fastify server (the only deployed backend)
│   ├── web/             # React admin/operator UI
│   └── web-tenant/      # React tenant-facing UI  (may merge with web later)
├── packages/
│   ├── db/              # Drizzle schemas (control-plane + tenant) + migration runner
│   ├── core/            # Domain services usable by core or modules (auth, users, files, audit, notifications)
│   ├── connectors/      # Email + file-storage connector framework + built-in implementations
│   ├── module-sdk/      # Public API surface that per-client modules build against
│   ├── api-contract/    # Zod schemas + generated OpenAPI types (shared by api + web clients)
│   └── ui/              # Shared React components (design system)
├── clients/
│   └── cnn-construction/  # Per-client module pack (Prospector, Proposal automation)
└── tools/                 # Build scripts, migration CLI, tenant-provisioning CLI
```

**Why this layout:**
- `apps/api` is the only deployable backend — modules and client packs are libraries it imports
- `packages/api-contract` is the single source of truth for request/response shapes; both server and web import from it
- `clients/<slug>/` is the extensibility seam — each client gets a directory, opted into via tenant config
- `packages/module-sdk` defines what a client module is *allowed* to do (so we can keep core stable as modules evolve)

### 2.6 Query layer: Drizzle ORM

Schemas in `packages/db`. Migrations via `drizzle-kit`. Per-tenant connection pattern: a small `getTenantDb(tenant)` helper returns a Drizzle instance bound to that tenant's connection pool (pool acquired from a tenant-keyed cache).

**Why:**
- TS-first, no codegen step (the schema *is* the type)
- Lightweight enough to instantiate per-connection without memory blowup (unlike Prisma)
- Same schema definition runs against every tenant DB → migrations stay uniform across clients

### 2.7 Auth: server-side sessions + httpOnly cookie

**Mechanism:** On login, server validates credentials against the tenant DB, creates a row in `sessions` (id, user_id, created_at, expires_at, ip, user_agent), and sets an httpOnly + Secure + SameSite=Lax cookie scoped to the tenant subdomain. Every authed request looks up the session row in the tenant DB. Logout deletes the row.

**v1 auth features:**
- Email + password (Argon2id hashing, configurable cost)
- Password reset via emailed single-use token (15-min expiry)
- TOTP MFA, optional per user (RFC 6238; QR-code enrollment; recovery codes table)

**Deferred:** Magic-link login (reuses reset-token plumbing — small lift later), SSO/SAML (per-client enterprise need), social login (not relevant for B2B yet).

**Why:**
- Cookies + per-tenant subdomain = no cross-tenant cookie leakage
- Server-side sessions = instant revocation (force-logout a user is a `DELETE` on one row)
- TOTP baked in v1 avoids painful retrofit later; clients can opt in per user

**Implications:**
- Mobile native clients need to handle cookie storage (every native HTTP lib supports this). If/when we ship native mobile, we can add JWT as a parallel mechanism then.
- Need a transactional email provider (Postmark / Resend / SES) — covered in connector section
- Session table goes in every tenant DB, not control plane

### 2.8 Extensibility: static plugin registry

**Concept:** Each client's custom functionality lives in `clients/<slug>/` as a TypeScript package that exports a `ClientModulePack`. A pack contains one or more `Module` objects. The API server statically imports every pack at build time. The control-plane DB stores, per tenant, which modules are enabled.

**Module shape (defined in `packages/module-sdk`):**
```ts
interface Module {
  slug: string;                      // 'prospector', 'proposal-automation'
  version: string;
  routes?: FastifyPluginAsync;       // module's API routes, mounted at /api/m/<slug>/
  migrations?: Migration[];          // tenant-DB schema additions owned by this module
  jobs?: JobDefinition[];            // background jobs registered with the queue
  permissions?: PermissionDef[];     // roles/permissions this module introduces
  connectorRequirements?: string[];  // e.g. ['file-storage', 'email'] — provisioning checks tenant has these
}
```

**Request-time enforcement:** A Fastify pre-handler reads the tenant's `enabledModules` list (cached). If a request hits `/api/m/prospector/...` and the tenant doesn't have `prospector` enabled, return 404.

**Migrations:** Module migrations are tagged with the module slug. When a tenant enables a module, the migration runner applies that module's migrations to that tenant's DB. Disabling a module does NOT drop tables (data preserved; reversible).

**Why static over dynamic:**
- Type safety end-to-end (module routes know core types)
- One binary to deploy, debug, and observe
- Security: only code you committed runs in your process
- Cost (rebuild to ship a new client) is acceptable while we're operating a small number of clients

**Implications:**
- Adding a new client = new directory under `clients/`, register the pack in `apps/api/src/modules.ts`, deploy
- A client's module pack can depend on `packages/core` and `packages/module-sdk` but MUST NOT import from another client's pack
- Lint rule (e.g. eslint-plugin-boundaries) enforces this

### 2.9 Connector framework

**Pattern:** Each connector *type* (email, file-storage, …) has an interface in `packages/connectors`. Each *provider* implements that interface.

```ts
interface FileStorageConnector {
  list(path: string): Promise<FileEntry[]>;
  read(path: string): Promise<Stream>;
  write(path: string, content: Stream): Promise<void>;
  delete(path: string): Promise<void>;
  // ...
}

interface EmailConnector {
  send(msg: OutboundEmail): Promise<{ id: string }>;
  listInbox(opts: ListOpts): Promise<EmailHeader[]>;
  fetch(id: string): Promise<Email>;
  // ...
}
```

**v1 providers:**
- Email: Microsoft Graph (Office 365), Gmail API, IMAP+SMTP fallback
- File storage: Microsoft Graph (OneDrive), Dropbox, Google Drive
- Transactional email (for system mail like password reset): Postmark or Resend (single provider, separate from per-tenant email connectors)

**Per-tenant config:** Tenant DB has a `connector_configs` table: which provider is bound to which capability, plus encrypted credentials (OAuth tokens or app-password). Modules request `getConnector('file-storage')` from a tenant-scoped context — they never name a provider.

**OAuth flows:** Stored centrally in `packages/connectors/oauth/` — each provider has its own redirect handler. Tokens encrypted at rest in tenant DB (column-level encryption via libsodium; key from env).

### 2.10 Background jobs: pg-boss

Per-tenant queue: jobs live in each tenant DB (pg-boss creates its own schema). A single worker process (or N workers) connects to all tenant DBs and polls each. Modules register jobs via the `Module.jobs` field.

**Why pg-boss:** No Redis to operate. Transactional with the rest of tenant data (enqueue+write in one tx). Easy to inspect (it's just a Postgres table).

**Worker process:** Same `apps/api` binary, started with `--worker` flag, deployed as a separate process from the HTTP server for isolation (a runaway job can't take down the API). Both processes share the same code, connection pools, and tenant resolver.

### 2.11 Deployment: single VPS + managed Postgres

**v1 target:** Fly.io (or Railway / Hetzner Cloud — final pick at implementation time). Components:
- `apps/api` — 1+ instances behind a load balancer
- `apps/api --worker` — 1+ background worker instances
- `apps/web` — static build served from CDN
- Managed Postgres (control-plane DB + tenant DBs on the same cluster initially; can split later)
- Object storage for direct-upload files that bypass connectors (S3-compatible: R2 or Backblaze B2)

**Wildcard TLS:** Let's Encrypt via DNS-01 challenge, or rely on hosting provider's built-in wildcard support.

### 2.12 Observability

- **Logs:** Pino (structured JSON) with `tenant_slug`, `tenant_id`, `request_id`, `user_id` injected on every log line. Shipped to host's log aggregation (Fly logs, Better Stack, etc.).
- **Errors:** Sentry, tagged with `tenant_slug` and `module_slug`.
- **Uptime:** External ping on the control-plane health endpoint and a sample tenant health endpoint.
- **Audit log:** Per-tenant `audit_log` table in tenant DB — every state-changing API call writes a row (actor, action, target, timestamp, request_id). This is product feature, not just ops.
- **Defer:** OpenTelemetry tracing, metrics dashboards. Add when there's a perf problem to investigate.

---

## 4. Architecture Overview

### 4.1 Request lifecycle (authenticated tenant request)

1. **DNS** resolves `cnn.businessos.app` to the load balancer.
2. **Load balancer / TLS** terminates TLS (wildcard cert), forwards HTTP to an API instance.
3. **Fastify `onRequest` hook (`tenant-resolver`)** parses subdomain from `Host` header, looks up tenant in control-plane cache (5-min TTL, invalidated on tenant update). Populates `req.tenant = { id, slug, dbConfig, enabledModules }`. If tenant not found → 404.
4. **Fastify `onRequest` hook (`db-binder`)** acquires a Drizzle instance for the tenant DB from a pool-of-pools and attaches to `req.db`.
5. **Fastify `preHandler` hook (`auth`)** reads session cookie, looks up `sessions` row in `req.db`, validates expiry, loads user, attaches `req.user`. Public routes skip this.
6. **Module gate (only for `/api/m/<slug>/...` routes)** checks `req.tenant.enabledModules` contains `<slug>`. 404 if not.
7. **Route handler** runs. Validates body with Zod, calls into `packages/core` services or module-local code.
8. **`onResponse` hook** writes audit-log row for state-changing requests; logs request line with all context.

### 4.2 Tenant provisioning flow

1. Operator runs `pnpm tenant:create --slug cnn --name "CNN Construction"` (CLI in `tools/`).
2. CLI: creates a new database `tenant_cnn`, runs all core migrations + migrations for the modules listed in the tenant's enabled set, inserts tenant row in control-plane DB, prints initial admin invite link.
3. Operator visits invite link, sets up first admin user.

### 4.3 Per-tenant DB connection pool strategy

- One Postgres cluster, many databases (one per tenant) — at least until scale demands sharding.
- Each API process keeps a `Map<tenantId, Pool>` (LRU, max ~100 pools, idle eviction at 5 min).
- Each pool: `min=0, max=5` connections. Total connection budget = `pools × max × instances`. Plan for sizing during deployment, not now.

### 4.4 Tenant DB schema (core, v1)

- `users` — id, email (unique), password_hash, mfa_secret (encrypted), mfa_enabled, created_at, …
- `sessions` — id, user_id, expires_at, ip, user_agent
- `password_reset_tokens` — token_hash, user_id, expires_at, used_at
- `mfa_recovery_codes` — code_hash, user_id, used_at
- `roles`, `permissions`, `role_permissions`, `user_roles` — RBAC primitives
- `audit_log` — id, actor_user_id, action, target_type, target_id, request_id, ip, timestamp, payload jsonb
- `connector_configs` — id, capability, provider, config_encrypted, created_by
- `oauth_states` — short-lived state tokens for OAuth handshakes
- `files` — first-class file metadata (id, name, size, mime, storage_provider, storage_key, owner_id, …)
- `notifications` — id, user_id, type, payload jsonb, read_at
- `module_state` — id, module_slug, key, value jsonb — generic KV for modules that don't want their own table yet
- pg-boss tables (auto-created by pg-boss in its own schema)

### 4.5 Control-plane DB schema

- `tenants` — id, slug, name, status (active/suspended/deleting), db_host, db_name, db_user, db_password_encrypted, created_at
- `tenant_modules` — tenant_id, module_slug, enabled, version, settings jsonb
- `billing_*` — deferred; placeholder
- `operator_users` — your own (operator) staff who manage the control plane (separate from any tenant's users)
- `operator_sessions` — for the control-plane admin UI

---

## 5. Cross-cutting concerns

### 5.1 Secrets & encryption

- All connector OAuth tokens and connector credentials: column-level encryption with libsodium `crypto_secretbox`. Key from env var, rotated via control-plane operation (re-encrypt all rows).
- Tenant DB passwords: encrypted in control-plane `tenants` table.
- Session cookies: opaque ids, `HttpOnly; Secure; SameSite=Lax; Path=/; Domain=<tenant>.businessos.app`.

### 5.2 Migrations

- Two migration sets: control-plane (`packages/db/migrations/control-plane`) and tenant (`packages/db/migrations/tenant`).
- Tenant migrations broken into "core" + per-module. A migration runner CLI iterates tenants, applies pending migrations in deterministic order.
- Migrations are forward-only. Down migrations only exist for the most-recent unreleased one (escape hatch in dev).

### 5.3 Testing

- **Unit tests:** Vitest. Pure functions and isolated services.
- **Integration tests:** Vitest + a real Postgres in Docker. Each test gets a freshly-migrated tenant DB. No mocks for DB layer.
- **Contract tests:** Generated OpenAPI client tested against the live API in a smoke suite.
- **Per-module tests:** Each module package has its own test suite using the same harness.

### 5.4 What lives where (recap)

| Concern | Lives in |
|---|---|
| Tenant routing logic | `apps/api` Fastify plugin |
| User identity | Tenant DB |
| Tenant registry, billing | Control-plane DB |
| Sessions | Tenant DB |
| OAuth tokens | Tenant DB (encrypted) |
| Background jobs | Tenant DB (pg-boss) |
| Files (metadata) | Tenant DB |
| Files (blobs) | Object storage OR external connector (Dropbox/OneDrive) |
| Per-client business logic | `clients/<slug>/` package |
| Reusable connectors | `packages/connectors` |

---

## 6. Success criteria for the Foundation

The foundation is "done" when:

1. A new tenant can be provisioned with one CLI command, including DB creation, migrations, and operator invite.
2. A user can sign up via invite, set up password + optional TOTP, log in, and log out — all scoped to their tenant subdomain.
3. A core API endpoint (e.g. `GET /api/users/me`) works correctly across two distinct tenants on the same instance with zero data crossover.
4. A minimal example module (under `clients/demo/`) demonstrates: enabling it on a tenant adds its routes, applies its migrations, and disabling it removes route access without dropping data.
5. A connector can be configured (e.g. Dropbox OAuth) and accessed by module code via `getConnector('file-storage')`.
6. A background job enqueued from a request runs and writes an audit-log row in the correct tenant DB.
7. Integration tests pass against a real Postgres covering: signup, login (with and without MFA), password reset, tenant isolation, module gating, connector config, and job execution.
8. Sentry receives a deliberately-thrown error, tagged with the correct `tenant_slug`.

---

## 7. Out of scope (separate specs)

- Mobile client (PWA vs React Native decision)
- Admin/operator UI for managing tenants (control-plane UI)
- Tenant-facing web UI shell
- CNN Construction's Prospector module
- CNN Construction's Proposal Automation module
- Billing
- SSO / SAML
- Marketplace / third-party developer modules
- Operator/support access mechanism (which control-plane UI uses to "sudo into" a tenant DB)
