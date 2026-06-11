# End-User Dashboard, Daily Digest, and Scoring Feedback

**Date:** 2026-06-11
**Status:** Draft. Documents proposed primitives layered on top of the existing module + agent contracts. Not yet implemented.
**Related:**
- [2026-06-09-module-sdk.md](2026-06-09-module-sdk.md) — modules already own state, routes, UI pages, settings. This spec does not change that contract.
- [2026-06-10-ux-audit.md](2026-06-10-ux-audit.md) — covers the *operator* dashboard. This spec introduces a separate *end-user* dashboard.
- [2026-06-06-business-os-architecture.md](2026-06-06-business-os-architecture.md)

---

## Context

The C&M Construction Prospector use case is the forcing function:

- An agent crawls public RFQ listings hourly. Carlos and his estimators need to know what's new or changed.
- An email-triage agent reads their shared inbox and surfaces messages worth bidding/quoting on.
- Carlos does NOT want a flood of emails. He wants a single morning digest + a place he lands during the day to see what's actionable.
- For each RFQ, the system should show a confidence score ("we think you should bid on this — 8/10 because it looks like 3 jobs you already bid on") and learn from his thumbs up/down.

Three concerns fall out of this:

1. **An end-user dashboard.** The existing `/dashboard` (`pages/Dashboard.tsx`) is for the *operator* — agent runs, capability coverage, system health. The Prospector use case needs a *business-user* dashboard: actionable cards rendered from module state, grouped per module, per-user reorderable. Different audience, different content, different page.
2. **A daily digest.** One email per user per morning, summarizing "what's new since yesterday" across the installed modules, linking back to the dashboard. Plus an urgent escape hatch for time-critical items (RFQ due in < N days).
3. **Scoring with feedback.** Agents that surface items for human triage (RFQs, emails, leads) should produce a 0–10 confidence score with a one-line "why," accept thumbs up/down per item, and use past feedback as in-context examples on future scoring.

None of this requires changing the module SDK contract. It adds three new primitives that modules opt into.

## Decision

Layer three new optional primitives on top of the existing module contract:

| Primitive | Owner | What it does |
|---|---|---|
| **Dashboard sections** | Module | Module declares one or more dashboard sections; the framework renders them on `/home` as cards, grouped per module. Per-user reorderable. |
| **Digest contributions** | Module (or agent) | A function the framework calls once at digest-build time; returns the summary items to include in tomorrow's email for a given user. |
| **Scoring + feedback** | Agent | Agents that produce scored items declare a `feedbackSchema`. A new `ctx.recall(query, n)` helper retrieves similar past items + their feedback for use as in-context examples. |

Each is independently adoptable. A module can have a dashboard section but no digest contribution. An agent can score items without contributing to any dashboard. Adopting all three is the Prospector case.

**Locked decisions to NOT re-litigate:**
- No new runtime layer. Modules don't run. Agents still run on their own schedule. Coordination is data-shaped, not control-flow-shaped.
- No "training" in the ML sense (no fine-tuning, no rule-learning system). "Train" in the UX copy maps to in-context retrieval of past feedback. Cheap, works day one, explainable.
- Urgent notifications reuse email — `[URGENT]` prefixed transactional email via the system email connector. No SMS or push framework in v1.

## End-user dashboard

### URL and audience

- Mounted at `/home`. (Reserved separately from `/dashboard`, which stays the operator's page.)
- All authenticated users land here on login. The Login redirect changes from `/agents` to `/home`. The operator `/dashboard` stays accessible from the sidebar under "Operator."
- Sidebar grouping becomes:
  - **Business:** Home (`/home`), each installed module's UI pages
  - **Operator:** Agents, Connectors, Providers, Audit, Settings

### Section contract

Modules export a new optional field on the module manifest:

```ts
// in @business-os/module-sdk
export interface DashboardSection {
  /** Stable id within the module — used as the per-user reorder key. */
  id: string;
  /** Heading shown above the section. */
  title: string;
  /** Optional one-liner under the title. */
  subtitle?: string;
  /** Audience tag — same enum as ModuleUiPage. Empty = all users. */
  audience?: AudienceTag;
  /**
   * Server-side fetch that returns rows to render. Called per-user on every
   * dashboard load. The framework handles caching (60s SWR by default).
   */
  fetch: (ctx: DashboardFetchContext) => Promise<DashboardCard[]>;
  /** Optional override of the default card renderer. */
  Component?: ComponentType<{ cards: DashboardCard[] }>;
}

export interface DashboardCard {
  id: string;                       // stable per item; survives across fetches
  title: string;                    // primary text
  subtitle?: string;                // secondary text (deadline, source, etc.)
  badge?: { text: string; tone: 'new' | 'updated' | 'urgent' | 'info' };
  score?: { value: number; max: number; reason?: string };  // see Scoring section
  href?: string;                    // where clicking the card goes
  feedback?: { kind: 'thumbs'; itemRef: string };           // see Scoring section
}

export interface DashboardFetchContext {
  user: { id: string; email: string };
  since: Date;                      // when this user last visited /home
  logger: ModuleLogger;
}

export interface ModuleManifest<T> {
  // ... existing fields ...
  dashboardSections?: DashboardSection[];
}
```

The framework renders each section as a card group. Default renderer is a vertical list of items with title/subtitle/badge/score. Modules may override for richer renderings (tables, kanban, calendar) by providing `Component`.

### Per-user reorder

- The order of sections on `/home` is a per-user setting persisted in `user_dashboard_layout` (new core table, `{ user_id, ordered_section_keys: text[] }`).
- A section key is `<module_slug>:<section_id>`.
- Drag-and-drop reorder writes to the same row. Users may also hide a section (visibility filter on top of the ordering array).
- Default order on first visit: the order modules are declared in `business-os.config.ts`, then `dashboardSections[]` order within each.

### Empty + loading states

- Each section renders its own skeleton during `fetch`. The whole page does NOT block on the slowest section.
- A section returning `[]` collapses to a `<title>: Nothing new` line, not a full empty card. This keeps the dashboard scannable when most sections are quiet.

## Daily digest

### Build + send

- A new framework agent (`@business-os/agent-digest`) runs once a day. Default schedule: `0 7 * * *` in the install's configured timezone. Schedulable like any agent, overridable per the existing schedule-override mechanism.
- For each user with a verified email, the digest agent:
  1. Calls each module's `digestContribution(user, since: lastSendOrInstallDate)` in parallel.
  2. Drops empty contributions.
  3. Renders one email with a section per contributing module + a "Open dashboard" CTA.
  4. Records `last_digest_sent_at` per user.

### Contribution contract

```ts
export interface DigestContribution {
  sectionTitle: string;
  summary: string;                                  // one-line lead, optional
  items: Array<{
    title: string;
    subtitle?: string;
    href: string;                                   // deep link to dashboard / detail
    isUrgent?: boolean;                             // controls urgent escalation
  }>;
}

export interface ModuleManifest<T> {
  // ... existing fields ...
  digestContribution?: (ctx: DigestContext) => Promise<DigestContribution | null>;
}

export interface DigestContext {
  user: { id: string; email: string };
  since: Date;
  logger: ModuleLogger;
}
```

Returning `null` (or a contribution with `items: []`) excludes the module from this user's digest.

### Urgent escape hatch

- If any item across any module returns `isUrgent: true`, the digest agent ALSO sends an immediate `[URGENT]` email (separate from the morning digest, sent at most once per item).
- "Urgent" is module-defined. For Prospector v1: any RFQ whose deadline is `< 48h` and which scored above the user's threshold. Configurable per module's settings, not in the framework.
- The dedup key is `(user_id, urgent_item_ref)`. New table `urgent_notifications_sent`.

### Why not SMS?

- Carlos already lives in email. Adding SMS = new system email provider config, phone number storage, opt-in compliance.
- Email with `[URGENT]` subject prefix gets push-notified by his mail client.
- Reopen if a real client says email isn't enough.

## Scoring + feedback + recall

### Score on a card

Cards may include a `score: { value, max, reason }`. Renderer shows a small badge: e.g. `8/10 — looks like 3 jobs you bid on`. The reason is required when a score is present; we don't ship inscrutable numbers.

### Feedback on a card

Cards with `feedback: { kind: 'thumbs', itemRef }` render thumbs up / thumbs down buttons. Click writes to a new core table:

```sql
CREATE TABLE item_feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  module_slug   text NOT NULL,
  item_ref      text NOT NULL,           -- module-defined; usually <table>:<id>
  rating        smallint NOT NULL,       -- +1 / -1
  reason        text,                    -- optional, future free-text field
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, module_slug, item_ref)
);
```

One row per `(user, module, item)` — latest rating wins on conflict.

### `ctx.recall()` — the in-context primitive

A new helper on `AgentContext`:

```ts
ctx.recall<T>(query: {
  moduleSlug: string;
  text: string;            // the new item's text representation for similarity
  k: number;               // top-k similar past items to return
  ratedBy?: string;        // optional: scope to feedback from one user
}): Promise<Array<{ item: T; rating: 1 | -1; reason?: string }>>;
```

Behavior:
- Embeds `text` using the install's `llm` connector (capability already exists).
- Looks up past items in the module's table that the user has rated; computes cosine similarity.
- Returns the top-k.

The agent uses the result to build an in-context prompt: "Here are similar past items the user rated. Score this new one and explain why."

Storage:
- A new core table `item_embeddings (module_slug, item_ref, embedding vector, created_at)` indexed with `pgvector`.
- Modules opt in by writing to this table when they create or update scoreable items (same lifecycle as their existing tables; module owns its write path).

### What we are NOT building (yet)

- No fine-tuning loop.
- No automatic rule extraction from feedback ("the user always says no when X").
- No multi-user federation of feedback ("Carlos's no's apply to estimator Bob"). Feedback is per-user.

These are all reachable later via additional `ctx` helpers. Don't pre-build.

## Worked example: Prospector module

The Prospector module ships as `@business-os/module-prospector`. It owns:

- Tables: `rfqs`, `rfq_diffs`, `triaged_emails`.
- Settings: trade categories, geographic scope, deadline-urgency threshold (default 48h), score threshold for urgent escalation (default 7).
- UI pages: `/modules/prospector/rfqs`, `/modules/prospector/emails`, detail pages.
- Dashboard sections:
  - `rfqs:new` → cards for RFQs first seen since the user's `since`.
  - `rfqs:updated` → cards for RFQs where a watched field changed.
  - `emails:to-triage` → cards for emails the triage agent flagged.
- Digest contribution: aggregates "N new RFQs, M updated, K emails" + the top-3 by score. Marks any with deadline `< 48h` and `score >= threshold` as urgent.

Two agents support it:

- `@business-os/agent-rfq-crawler` — `cron: 0 * * * *` (hourly). Uses a `web-scraper` connector (or per-target adapter). For each item: computes embedding, calls `ctx.recall()` to fetch the user's past ratings of similar RFQs, calls LLM to score, upserts via `POST /modules/prospector/rfqs`. Per-user scoring: the agent iterates users with prospector access and scores once per user (cheap because the recall cache hits).
- `@business-os/agent-email-triage` — `event: email-received` (or `cron: */15 * * * *` if event delivery isn't wired). Same pattern: embed, recall, score, post to the module.

Both agents declare:

```ts
feedbackSchema: { kind: 'thumbs' }      // already standard; this just opts in
```

Failure modes worth noting:
- **No past feedback yet.** `ctx.recall()` returns empty. Scorer falls back to settings-only criteria. Confidence reason explicitly says "no history yet — based on your settings."
- **Embedding cost.** Limited by hourly cadence + cap on items embedded per run. Cost-visibility spec handles tracking.

## Sidebar + nav implications

Update the operator UI shell:

- Add `/home` as the post-login landing. Login redirect changes from `/agents` to `/home`.
- Sidebar gets two groups: **Business** (Home + each module's `navLabel`-tagged pages) and **Operator** (Agents, Connectors, Providers, Audit, Settings).
- `/dashboard` stays for the operator. We may rename its sidebar label to "System health" later — out of scope here.

## What this spec does NOT cover

- Cross-module dashboard widgets that read from multiple modules. Out of scope; modules contribute sections independently.
- A "workflow" UI for taking action on a card (assign to teammate, mark as bidding). Each module's UI pages handle that today. The dashboard card's `href` is the entry point.
- Real-time updates (websocket push). v1 polls on dashboard load; future PR may add SSE.
- Notification preferences UI per user (mute a module's digest, set quiet hours). Out of scope; everyone with module access gets the digest in v1.

## Open questions

1. **Default `since` window for first-time dashboard visit.** A new user has no `last_seen_at`. Use install date? 7 days ago? Module-defined? Lean toward 7 days as a sane default.
2. **Reorder UX.** Drag-and-drop on web is fine; on a PWA on mobile we'll need a "Reorder" mode (long-press → drag). Defer to implementation.
3. **Score normalization across modules.** RFQs and emails both 0–10. If a future module uses 0–100, the dashboard renderer shows mixed scales. Probably fine; modules pick a scale that fits. Reopen if it gets confusing.
4. **Cost of per-user scoring.** Each agent run scores items per-user. For 5 users × 50 new RFQs/hour = 250 LLM calls/hour. Acceptable for v1 with small N. Watch the cost dashboard.
5. **Urgent dedup window.** Currently "once per item ever." Should it be "once per item per 24h"? Reopen when a real urgent fires twice.

## Implementation order

1. `dashboardSections` field on `ModuleManifest` + `/home` route in operator UI shell + default renderer + `user_dashboard_layout` table + reorder.
2. `digestContribution` field + `@business-os/agent-digest` + `urgent_notifications_sent` table.
3. `item_feedback` + `item_embeddings` tables + `ctx.recall()` helper + feedback wire-up on cards.
4. Prospector module + RFQ crawler agent + email-triage agent.

Each step is independently shippable. Step 4 doesn't block on perfect implementations of 1–3 — start with hardcoded scores in the Prospector module to validate the UX, then wire in recall.
