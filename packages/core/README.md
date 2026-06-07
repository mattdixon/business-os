# @business-os/core

The runnable spine of a Business OS install.

## What's here

- **Fastify app factory.** `buildApp({ db, secrets, encryptionKey, clientSlug, inventory, trigger })` wires request_id, Pino with structured redactions, /healthz, /readyz (DB ping), session cookie handling, and all routes.
- **Auth.** Argon2id passwords, session cookies (sha256-hashed at rest), 15-min single-use password reset tokens, RFC-6238 TOTP. Verify-then-burn dummy-hash trick on unknown emails to keep timing constant.
- **Secrets.** libsodium `crypto_secretbox_easy` keyed off `SECRETS_KEY`. `SecretsStore` is the only way bytes leave the DB unencrypted.
- **Audit.** `audit(ctx, action, meta)` writes correlated rows. `req.audit(action, meta)` is bound to every request and gets `request_id` + `user_id` for free.
- **Admin REST API.** `/api/agents`, `/api/agents/:slug/settings`, `/api/agents/:slug/run`, `/api/agents/:slug/runs`, `/api/connectors`, `/api/connectors/:id`, `/api/connectors/:id/credentials`, `/api/audit`. All auth-gated.
- **Zod → form schema.** `zodToFieldSchema()` walks an agent/connector's manifest schema and emits a discriminated union the UI auto-renders into a typed form.
- **Sentry.** `initSentry({ dsn, clientSlug })`, `registerFastifySentry(app)`, `captureAgentError(err, { agentSlug, runId, clientSlug })`. DSN-driven; no-op when empty.
- **Boot.** `startServer({ inventory, triggerFactory, migrations, mode })` validates env, runs migrations, builds the SecretsStore, optionally starts Fastify, optionally starts the scheduler. Three modes: `api`, `worker`, `both`.
- **Static UI.** Serves `@business-os/ui/dist` at `/` via `@fastify/static` with SPA fallback. Disabled with `serveUi: false` for test harnesses.

## Use

Client shells call `startServer({...})`. Tests use `buildApp({...})` directly.

```ts
import { startServer } from '@business-os/core';
import { Registry, Scheduler, createConnectorResolver, createJobsBackend } from '@business-os/runtime';

const registry = new Registry();
// registry.registerAgent(...)
// registry.registerConnectorProvider(...)

await startServer({
  inventory: registry,
  triggerFactory: ({ startScheduler }) => {
    /* construct Scheduler + JobsBackend, return ManualTriggerer */
  },
  mode: process.argv.includes('--worker') ? 'worker' : 'both',
});
```

See `templates/client-starter/src/index.ts.tmpl` for the canonical wire-up.
