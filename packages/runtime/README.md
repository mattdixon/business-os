# @business-os/runtime

Boots agents: registry, ctx factory, runAgent, scheduler, jobs.

## What's here

- **`Registry`** — agents and connector providers, keyed by slug + capability. Duplicate registrations are hard errors. Used both server-side (admin API) and runtime-side.
- **`createConnectorResolver({ db, secrets, registry, logger })`** — resolves a connector for a capability. Default mode returns the operator-chosen *active* provider (`is_active=true`). Pass `{ providerSlug }` to pin a specific provider — used by the `LlmPicker` convention in agent-sdk so operators can choose provider + model per agent.
- **`runAgent(deps, slug, input, trigger)`** — records an `agent_runs` row, validates settings against the manifest's Zod schema, builds the `AgentContext` (logger, db, capability-keyed connector lookup, audit, jobs), calls `agent.run(ctx, input)`, stamps the row. Optional `onAgentError` sink → Sentry.
- **`Scheduler`** — `start()` walks the registry and installs cron jobs for cron-scheduled agents, builds a topic → subscribers map for event-scheduled agents. `triggerManual(slug, input, userId)` and `fireEvent(topic, payload)` work regardless of schedule kind.
- **`createJobsBackend({ databaseUrl, db, registry, connectors, logger })`** — pg-boss-backed durable jobs. Job name matching an agent slug routes to `runAgent`; anything else routes to a `jobs.subscribe(name, handler)` registration. Honors `idempotencyKey` via pg-boss singletonKey.

## Use

Client shells construct these once at boot and hand the scheduler back to `startServer` via `triggerFactory`. Tests construct them inline against a real Postgres.
