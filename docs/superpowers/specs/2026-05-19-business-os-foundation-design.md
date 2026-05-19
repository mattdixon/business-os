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

---

## 3. Decisions Pending

(Filled in as the brainstorm progresses.)

- Stack & monorepo layout
- Auth & identity model
- API framework choice (Fastify / Hono / NestJS / tRPC / other)
- Per-client extensibility model (how modules plug in)
- Connector framework (Email: O365/Gmail/IMAP; Files: OneDrive/Dropbox/GDrive)
- Background jobs / async work
- Deployment target
- Observability baseline
