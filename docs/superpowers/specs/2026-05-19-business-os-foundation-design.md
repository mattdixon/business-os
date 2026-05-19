# Business OS — Foundation Design

**Status:** Draft (in progress)
**Date:** 2026-05-19
**Scope:** Core platform foundation. Per-client modules, mobile client, and admin UI are separate specs.

---

## 1. Purpose

A multi-tenant Business OS platform that serves multiple client businesses from one codebase. Generic core + per-client implementation layer. API-first so web, mobile (PWA or native), and agents can all consume the same secured endpoints.

**First client:** CNN Construction (concrete company; needs Prospector and Proposal-automation modules; uses Dropbox).

---

## 2. Decisions Locked

### 2.1 Tenancy: Database-per-tenant

Each client gets their own Postgres database. The platform-level "control plane" database stores the tenant registry, user identities (or federated identity mapping), billing, and routing metadata.

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

---

## 3. Decisions Pending

(Filled in as the brainstorm progresses.)

- Auth mechanism inside tenant DB (sessions vs JWT, password reset, MFA)
- Per-client extensibility model (how modules plug in)
- Connector framework (Email: O365/Gmail/IMAP; Files: OneDrive/Dropbox/GDrive)
- Background jobs / async work
- Deployment target
- Observability baseline
- Operator/support access mechanism
