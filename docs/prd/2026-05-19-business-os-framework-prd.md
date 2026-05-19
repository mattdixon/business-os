# PRD — Business OS Framework

**Status:** Draft v1
**Date:** 2026-05-19
**Author:** Matt Dixon (mattdixon)
**Related spec:** [Foundation Design](../superpowers/specs/2026-05-19-business-os-foundation-design.md)

---

## 1. Problem

Matt's agency (Front Range Systems) is building bespoke business-automation systems for multiple small/mid-market clients. Today, each engagement starts close to zero: authentication, multi-user permissions, file integrations, email integrations, audit trails, and deployment are rebuilt or re-stitched per client. This is expensive, slow, inconsistent, and creates a long tail of ten-different-codebases to maintain.

Each client also needs different *vertical* automation — a concrete company doesn't need what a law firm needs — but they all need the same *horizontal* plumbing.

## 2. Goal

A single platform — "Business OS" — that:
1. Provides the horizontal plumbing once, well, and reusably.
2. Lets each client's vertical automation live alongside it as a swappable module pack.
3. Runs many clients from one codebase with strong isolation between their data.
4. Is approachable for a small team (initially solo) to operate.

## 3. Target Users

### 3.1 Primary user: Matt (the operator)
Builds, maintains, and operates the platform. Onboards new clients. Writes client-specific modules. Needs:
- Fast time-to-first-feature for a new client
- Confidence that one client's bug can't expose another's data
- A clear seam between "core platform" and "this client's code"
- Sane defaults so most clients don't need custom infra decisions

### 3.2 Secondary user: client admins
At each client business, one or two people configure the system: invite teammates, connect their email/file-storage accounts, set up roles, watch the audit log.

### 3.3 Tertiary user: client end-users
Day-to-day employees at the client who use the modules to do their job (e.g., a CNN Construction estimator using the Prospector to find bids).

## 4. Scope (v1)

### 4.1 In scope
The framework v1 ships with everything needed to onboard the first paying client and run it in production:
- Tenant provisioning (CLI-driven)
- Per-tenant database isolation
- Subdomain-based tenant routing
- Authentication: email/password, password reset, TOTP MFA
- Role-based permissions
- Audit log
- Generic file metadata + first-class connector framework
- Connectors v1: Microsoft Graph (O365 email + OneDrive), Gmail, IMAP/SMTP, Dropbox, Google Drive
- Transactional email (system mail, not client mail)
- Background jobs (per-tenant)
- Module SDK: the contract that per-client packs implement
- Static plugin registry (modules activated per tenant via control-plane config)
- Structured logging + Sentry + uptime checks
- React web shell sufficient for client-admin tasks (full UI design is a separate spec)

### 4.2 Out of scope (deferred)
- Native mobile app (PWA covers mobile until a client asks otherwise)
- SSO / SAML
- Self-service tenant signup (onboarding stays operator-driven)
- Marketplace / 3rd-party modules
- In-platform billing
- Multi-region deployment
- Magic-link / social login

## 5. Non-goals
- **Not a low-code platform.** Client modules are TypeScript code that we write, not config artifacts a client builds themselves.
- **Not a CRM, ERP, or PMS.** The framework provides plumbing; vertical software lives in modules.
- **Not a workflow engine.** Modules orchestrate work using normal code + the job queue; no visual flow builder.

## 6. Requirements

### 6.1 Functional
| # | Requirement |
|---|---|
| F1 | Operator can create a new tenant with one CLI command (creates DB, runs migrations, generates admin invite). |
| F2 | A tenant's data is physically isolated in its own Postgres database. |
| F3 | A request to `cnn.businessos.app` cannot reach `acme.businessos.app`'s data under any code path, including bugs in module code. |
| F4 | A tenant admin can invite users by email; invitees set their own password and optionally enable TOTP MFA. |
| F5 | A tenant admin can connect at least one email provider and one file-storage provider via OAuth. |
| F6 | Modules can be enabled / disabled per tenant without code changes; disabling preserves data. |
| F7 | Every state-changing API call writes an audit-log entry visible to tenant admins. |
| F8 | Background jobs can be enqueued from request handlers and execute against the correct tenant DB. |
| F9 | A new module added to the codebase requires a build + deploy but no changes to existing client packs. |
| F10 | OpenAPI document is generated from the API and served at a stable URL for client codegen. |

### 6.2 Non-functional
| # | Requirement |
|---|---|
| N1 | p95 API latency under 300 ms for tenant-resolution + auth + a simple DB read. |
| N2 | Adding a new tenant takes under 5 minutes of operator time, including provisioning. |
| N3 | Errors automatically surface in Sentry with tenant tag within 30 seconds. |
| N4 | The codebase is approachable: a new developer should be able to ship a "hello world" module in under a day. |
| N5 | Secrets (OAuth tokens, tenant DB passwords) are encrypted at rest. |
| N6 | One running instance can serve at least 20 tenants without infra changes. |

## 7. Success Metrics
1. CNN Construction is live on the platform within the implementation timeline (see implementation plan).
2. Onboarding the second client takes ≤ 30% of the engineering time of CNN's onboarding (measured: hours from "we have a new client" to "client admin can log in").
3. Zero data-crossover incidents between tenants in the first six months.
4. ≥ 95% uptime on the API in the first three months after launch.

## 8. Key Decisions (summary)
For *how* these are implemented, see the [Foundation Design spec](../superpowers/specs/2026-05-19-business-os-foundation-design.md). Highlights:

- Database-per-tenant
- Identity lives inside each tenant DB
- Subdomain routing
- Fastify + Zod + OpenAPI
- pnpm + Turborepo monorepo
- Drizzle ORM
- Server-side sessions, Argon2id, optional TOTP MFA
- Static plugin registry for per-client modules
- pg-boss for background jobs
- Postmark/Resend for system email
- Fly.io-class deployment + managed Postgres

## 9. Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Migration runner gets out of sync across N tenant DBs | Medium | Idempotent migration table per tenant; provisioning CLI verifies parity on every operator action |
| Connection-pool sprawl as tenant count grows | Medium | LRU pool cache with cap; alert when nearing limit |
| Operator burnout from doing all onboarding manually | Medium | Make onboarding CLI rock-solid; revisit self-service after 5+ clients |
| A client demands an integration we don't have | High | Connector framework is the answer — adding a provider is a contained ~1-week task |
| Per-client modules drift in quality and create maintenance debt | High | Module SDK + lint boundaries + each pack has its own test suite |

## 10. Open Questions
- When (and if) to support multi-tenant operator dashboards across all tenants vs. logging into each.
- Whether to maintain an "internal staging tenant" used by Matt for dogfooding before client deploys.
- Long-term: do we expose the OpenAPI surface to client engineers (e.g. CNN's IT) so they can build their own integrations?

---

## 11. Related documents
- [Foundation Design (technical spec)](../superpowers/specs/2026-05-19-business-os-foundation-design.md)
- [CNN Construction Client PRD](./2026-05-19-cnn-construction-client-prd.md)
- [CLAUDE.md](../../CLAUDE.md) — repo conventions and locked decisions
