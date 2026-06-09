# Cost Visibility — Per-Agent + Per-App LLM & Connector Spend

**Date:** 2026-06-09
**Status:** Locked decision. Do not re-litigate without explicit approval.
**Related:** [docs/specs/2026-06-06-business-os-architecture.md](2026-06-06-business-os-architecture.md), [docs/specs/2026-06-08-integration-platform.md](2026-06-08-integration-platform.md)

---

## Context

Agents call LLMs. Agents call connectors. Connectors (Composio + direct) sometimes cost real money per call. None of this spend is currently visible inside the operator console:

- An operator can't see "the leadgen agent burned $14 of Claude tokens last week."
- An operator can't see "Composio actions are running 8K calls/mo across this install."
- An operator can't cap spend on a runaway agent before it eats the month's budget.
- A finance person can't pull a "month-to-date spend by agent" report without grepping logs.

Without this, the value-prop ("a custom OS that runs autonomously") collapses the first time a misconfigured cron racks up a $400 LLM bill overnight.

## Decision

**Build a cross-cutting cost-visibility primitive** with three layers:

1. **Emission** — runtime + LLM connectors + Composio connector emit `usage` rows tagged with capability, provider, model, agent slug, run id, dimensions, and cost.
2. **Rollups + caps** — operator UI surfaces per-agent, per-connector, and per-install totals over selectable windows; budget caps stop runs when exceeded.
3. **Pricing tables** — a versioned, hand-maintained per-model rate table in `@business-os/core` so token counts become dollar figures.

This belongs in the framework, not in any single agent. It is wired into `runAgent()` as a first-class context concern, identical to `audit`.

## Data model (locked)

### `usage` table — one row per billable event

Owned by `@business-os/db`. Forward-only migration adds it as `0003_usage.sql`.

```ts
export const usage = pgTable(
  'usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),

    // What kind of event this is.
    // 'llm'        — token consumption by an LLM connector
    // 'composio'   — a Composio action call (per-action pricing where exposed)
    // 'connector'  — direct connector calls with their own metered cost
    // 'other'      — escape hatch (e.g. file storage GB-month rollups)
    kind: text('kind').notNull(),

    // Capability the event belongs to (matches ConnectorCapabilityMap keys),
    // or null for kind='other' rows that don't map cleanly.
    capability: text('capability'),

    // Provider that produced the event.
    //   llm:       'anthropic' | 'openai' | ...
    //   composio:  'composio'
    //   connector: provider slug
    providerSlug: text('provider_slug').notNull(),

    // Model id for llm events ('claude-opus-4-7', 'gpt-4o'), or composio
    // action slug ('GMAIL_SEND_EMAIL'), or null.
    detail: text('detail'),

    // Quantities. Schema is intentionally flexible — different kinds use
    // different fields. NEVER store raw payloads here.
    //   llm: { inputTokens, outputTokens, cachedInputTokens? }
    //   composio: { actions: 1 }
    //   connector: { units: N, unitName: 'requests' | 'gb' | ... }
    quantities: jsonb('quantities').notNull(),

    // Computed cost in *USD micros* (millionths of a dollar). Integer math
    // for safe summation. Display layer divides by 1e6.
    // 1 USD = 1_000_000 micros.
    // Null if the pricing table didn't know how to price this event — the
    // event is still recorded so we can backfill later.
    costMicros: bigint('cost_micros', { mode: 'number' }),

    // Correlation: which agent + run produced this event.
    agentSlug: text('agent_slug'),
    runId: uuid('run_id'),

    // Free-form metadata (e.g. modelVersion, requestId from the provider).
    // NEVER put secrets, prompts, or responses here.
    meta: jsonb('meta'),
  },
  (t) => ({
    atIdx: index('usage_at_idx').on(t.at),
    agentIdx: index('usage_agent_idx').on(t.agentSlug, t.at),
    capabilityIdx: index('usage_capability_idx').on(t.capability, t.at),
    runIdx: index('usage_run_idx').on(t.runId),
  }),
);
```

Why bigint micros over `numeric`: integer summation is unambiguous, Drizzle handles it well, and we never need fractional micros. `1e6 * 50_000` (a $50K month) fits in a JS safe integer.

### `usage_budgets` table — per-scope spend caps

```ts
export const usageBudgets = pgTable(
  'usage_budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Scope. Exactly one of agentSlug / capability is set, OR both null
    // for an install-wide cap.
    agentSlug: text('agent_slug'),
    capability: text('capability'),

    // Rolling window. 'day' | 'week' | 'month'. Windows are calendar-aligned
    // in the install's TZ (env: TZ); week starts Monday.
    window: text('window').notNull(),

    // Cap in USD micros. NULL means "report-only" (no enforcement).
    limitMicros: bigint('limit_micros', { mode: 'number' }),

    // Behavior at limit:
    //   'block' — runAgent throws BudgetExceededError before invoking the
    //             agent's run() if the next call would cross the cap.
    //             ALSO cancels in-flight LLM/connector calls if the cap is
    //             crossed mid-run.
    //   'warn'  — log + audit + emit a one-per-window 'budget.exceeded' row
    //             but allow the run to continue. Operator sees a banner.
    //   'off'   — no enforcement (same as report-only).
    enforcement: text('enforcement').notNull().default('warn'),

    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeUniq: uniqueIndex('usage_budgets_scope_window_uniq').on(
      t.agentSlug,
      t.capability,
      t.window,
    ),
  }),
);
```

## Emission contract

### LLM connectors

`LlmCapability.complete(req)` already returns `usage: { inputTokens, outputTokens }`. Add an optional `cachedInputTokens` for providers that expose prompt-cache hits separately (Anthropic does).

Connectors do NOT write to the `usage` table themselves. They return the usage shape; the **runtime** writes the row, so accounting stays in one place and connectors stay stateless.

Per-LLM-call emission flow:
1. Agent calls `ctx.connector('llm').complete(req)`.
2. The resolved connector returns `{ content, stopReason, usage }`.
3. The runtime wraps each connector call (see below) and writes one `usage` row with `kind='llm'`, `providerSlug` = the resolved instance's provider, `detail` = `req.model ?? defaultModel`, `quantities = usage`.

### Composio connector

Composio's API returns per-call billing context in some plans; until we have that integration, the `@business-os/connector-composio` package emits a `usage` row with:
- `kind='composio'`
- `providerSlug='composio'`
- `detail = '<TOOLKIT>.<ACTION>'`
- `quantities = { actions: 1 }`
- `costMicros = null` until the pricing table understands per-action pricing.

This gives volumetric visibility immediately and lets us backfill cost when Composio exposes it.

### Direct connectors with their own meters

Direct connectors that have explicit per-call cost (Anthropic native, OpenAI native, S3 GB-storage rollups, etc.) emit usage rows themselves via a small helper on their `ctx` (see below).

### Runtime wrapping

`runAgent()` wraps the resolved connectors so that LLM calls produce usage rows transparently:

```ts
// In packages/runtime/src/run.ts
const baseConnector = ctx.connector;
ctx.connector = (capability, opts) => {
  const resolved = baseConnector(capability, opts);
  if (capability === 'llm') return wrapLlm(resolved, { runId, slug, providerSlug });
  return resolved;
};

function wrapLlm(llm: LlmCapability, ctx: WrapCtx): LlmCapability {
  return {
    async complete(req) {
      const res = await llm.complete(req);
      void recordUsage({
        kind: 'llm',
        capability: 'llm',
        providerSlug: ctx.providerSlug,
        detail: req.model ?? null,
        quantities: { ...res.usage },
        agentSlug: ctx.slug,
        runId: ctx.runId,
      });
      return res;
    },
    stream: llm.stream,
  };
}
```

`recordUsage()` is exposed on the `AgentContext` as `ctx.usage.record(event)` so:
- Direct connectors and per-client agents can record custom events.
- Tests can pass a no-op recorder.

The runtime resolves the dollar `costMicros` synchronously from the in-memory pricing table at write time. If the model isn't priced yet, the row is written with `costMicros = null` (cost can be back-filled).

### What about prompt content?

NEVER stored in `usage`. Token counts only. Privacy + retention reasons. If we need richer debugging later, we add a separate "llm calls" table that's TTL'd aggressively.

## Pricing table

`@business-os/core/pricing.ts` — versioned, hand-maintained:

```ts
export const PRICING = {
  // USD micros per 1M tokens.
  // Sources cited in comments; update quarterly.
  llm: {
    anthropic: {
      // https://docs.anthropic.com/pricing — verified 2026-06-09
      'claude-opus-4-7':    { inputPer1M: 15_000_000, outputPer1M: 75_000_000, cachedInputPer1M: 1_500_000 },
      'claude-sonnet-4-6':  { inputPer1M: 3_000_000,  outputPer1M: 15_000_000, cachedInputPer1M: 300_000 },
      'claude-haiku-4-5':   { inputPer1M: 800_000,    outputPer1M: 4_000_000 },
    },
    openai: {
      'gpt-4o':             { inputPer1M: 2_500_000,  outputPer1M: 10_000_000 },
      // ...
    },
  },
  // Composio is per-action when their billing surface exposes it. For now,
  // events are recorded with cost=null.
  composio: {},
} as const;
```

Pricing is intentionally a code constant, not DB-loaded. Reasons:
- Audit trail via git history.
- Pricing tables ship with the framework version the client is on; no async DB lookup in the hot path.
- Updates are quarterly at most. Hand-edit + version bump.

`priceEvent(event)` → `costMicros | null` is the single function the runtime calls; it dispatches by `kind` + `providerSlug` + `detail` to the right rate.

## Budgets + enforcement

Budgets are evaluated **before** each LLM/connector call when an active budget exists for the relevant scope:

```ts
async function checkBudget(scope: BudgetScope, nextEventCostMicros: number): Promise<void> {
  const b = await loadActiveBudget(scope);
  if (!b || b.enforcement === 'off' || b.limitMicros == null) return;

  const used = await sumUsage(scope, currentWindow(b.window));
  if (used + nextEventCostMicros < b.limitMicros) return;

  if (b.enforcement === 'block') {
    await audit('budget.exceeded.blocked', { scope, used, limit: b.limitMicros });
    throw new BudgetExceededError(scope, used, b.limitMicros);
  }
  // 'warn'
  await audit('budget.exceeded.warn', { scope, used, limit: b.limitMicros });
}
```

Per-call cost estimation: for LLM calls, we don't know exact cost before the call (output tokens aren't bounded). We estimate using `inputTokensFromRequest + maxTokens (output)` at the model's output rate. Pessimistic but defensible — operators can set caps with that in mind.

Composio + direct-connector events use the pricing table's per-call cost (when known) or skip the pre-check (when unknown).

A `BudgetExceededError` from inside an agent's `run()` becomes `ok=false, summary='budget exceeded'` on `agent_runs` and a Sentry event tagged with the budget scope.

### Window semantics
- `day`: midnight-to-midnight in the install's TZ.
- `week`: Monday 00:00 — Sunday 23:59:59 in the install's TZ.
- `month`: 1st 00:00 — last-day 23:59:59 in the install's TZ.

Use `date_trunc(window, at)` in SQL rollups for consistency.

## Operator UI

### `/usage` page (new top-level)

Three sections, each a `.card`:

1. **At a glance** — MTD total, prior month total, biggest spender (agent + provider) in big tiles.
2. **By agent** — table: agent slug | last 30d cost | last 7d cost | budget cap (if any) | sparkline.
3. **By capability + provider** — table: capability | provider | last 30d events | last 30d cost.

Filter chips: window (day/week/month/MTD), agent, capability, provider.

Empty state: "No usage recorded yet." until first run lands.

### Per-agent detail

Add a "Cost" section to `/agents/:slug` between Schedule and Recent Runs:
- MTD cost
- Budget cap status (with quick "Edit cap" → modal)
- Last 7-day sparkline

### Per-run detail

`/runs/:id` adds a section showing the run's own usage breakdown:
- LLM calls (count, model, in/out tokens, cost)
- Connector calls (capability, action, cost)
- Total

This makes "this run cost $0.84" answerable per-run, which is what an operator needs to triage a regression.

### CSV export

`GET /api/usage.csv?from=&to=&agentSlug=&capability=` — same auth as everything else, returns flat rows for finance.

## API surface

```
GET  /api/usage                    — rollups, filterable
GET  /api/usage/by-agent           — by-agent table data
GET  /api/usage/by-capability      — by-capability table data
GET  /api/usage/runs/:runId        — per-run breakdown
GET  /api/usage.csv                — flat export
GET  /api/usage/budgets            — list active budgets
POST /api/usage/budgets            — create/update a budget
DELETE /api/usage/budgets/:id      — delete
```

All Zod-validated via `@business-os/api-contract/usage.ts`. Auth = requireUser. Audit-logged on writes.

## Privacy

- `usage` rows are not customer-PII. They contain token counts and slugs, never prompt content.
- Retention: keep `usage` rows forever in the install's DB (they're tiny — < 200 bytes/row). Operators can opt to TTL on a per-install basis via a `USAGE_RETENTION_DAYS` env var; default = no TTL.
- Per-row `meta` MUST NOT include provider request bodies or prompts.

## Performance

- `usage` writes are async and best-effort. A failed insert MUST NOT break the agent's run — log + Sentry, move on.
- Rollups use `GROUP BY date_trunc(window, at), agent_slug` etc. with the indexes above. At 100K runs/year × ~5 events/run = 500K rows/year — fine for Postgres.
- The operator UI's at-a-glance tiles are computed at request time. If that becomes slow (>200ms), we add a `usage_rollups_daily` materialized table with a nightly job.

## Test plan

- Unit: pricing table dispatch, micros math (no float drift), window boundary math.
- Integration (Vitest + real Postgres): runAgent → wraps LLM connector → row lands in `usage` with right shape. Composio connector emits row on each action call. Budget pre-check throws `BudgetExceededError`. Mid-run budget breach (when `enforcement='block'`) cancels the in-flight call.
- E2E (manual): a Lead Gen agent run produces visible spend in the operator UI within 5 seconds of completion.

## Out of scope

- Forecasting / "you'll hit your cap in 3 days" — too speculative without longer history.
- Per-user cost attribution — operator UI is admin-only for now.
- Provider invoices reconciliation — we trust the pricing table; reconciliation against invoices is a manual finance task.
- Cross-install rollups — single-tenant-per-install means no central dashboard.

## Phased rollout

1. **Spec (this doc)** — locked.
2. **Phase 1 — emission only.** `usage` table, runtime LLM wrapping, pricing table for Anthropic + OpenAI, Composio events with cost=null, `ctx.usage.record` for direct connectors. No UI yet, no budgets. Validates the data model.
3. **Phase 2 — Operator UI.** `/usage` page, per-agent + per-run cards, CSV export.
4. **Phase 3 — Budgets.** `usage_budgets` table, CRUD UI, pre-call enforcement (warn first, block last). Audit trail. BudgetExceededError handling in runAgent.
5. **Phase 4 — Composio cost reconciliation.** Once Composio exposes per-action billing, backfill `costMicros` for prior rows and switch composio events to priced.

Each phase ships as its own PR.
