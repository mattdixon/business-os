# Module SDK — Third Framework Primitive

**Date:** 2026-06-09
**Status:** Locked decision. Documents the existing implementation in `@business-os/module-sdk` and the wiring in `@business-os/core` and `@business-os/ui`. Do not re-litigate without explicit approval.
**Related:** [docs/specs/2026-06-06-business-os-architecture.md](2026-06-06-business-os-architecture.md)

---

## Context

The framework already had two primitives:

- **Agent** — episodic worker. Runs on a schedule or event, pulls data, calls an LLM, writes audit + run rows, optionally calls connectors. No persistent state of its own beyond runs and settings.
- **Connector** — capability-shaped adapter to a third-party SaaS (`email`, `crm`, `llm`, `file-storage`, …). Stateless from the framework's view; credentials live in `secrets` keyed by connector instance.

Agents and connectors are both *fundamentally outbound*: they reach out to LLMs, mail providers, CRMs. Neither owns business state inside the install.

But real client deployments need to own business state too:

- **Inventory** (C&M): SKUs, on-hand counts, reorder points.
- **Jobs / projects**: estimates, change orders, status.
- **CRM-lite**: contacts, opportunities, when there's no external CRM yet.
- **Quotes, invoices, time tracking, equipment registers, …**

Each of these is a slice of state with:
- Its own tables (so the install owns the data, not some SaaS).
- Its own REST surface (so agents and the operator UI can query/mutate).
- Its own UI pages (so a human can look at the data and edit it).
- Its own settings (so per-install knobs work the same as agents and connectors).

This is the **module** primitive. The implementation already ships under `@business-os/module-sdk` (155 lines), `@business-os/core/modules.ts` (70 lines), and a worked-example module at `modules/example/`. This spec locks the contract that those files implement.

## Decision

**Modules are the third framework primitive, alongside agents and connectors.** Every module:

1. Declares a `ModuleManifest` (slug, version, displayName, settingsSchema, optional migrationsDir, optional defaultAudience).
2. Optionally implements `registerRoutes(app, ctx)` — Fastify routes mounted under `/api/modules/<slug>`. (Originally `/modules/<slug>`; namespaced under `/api/` after 2026-06-11 to keep API routes from colliding with SPA routes — see "URL namespacing" below.)
3. Optionally provides `uiPages[]` — React components mounted under `/modules/<slug>/<path>` in the operator UI, optionally surfaced in the sidebar.

Modules **own state**. Agents and connectors do not.

Modules are **per-install opt-in**, same as agents and connectors: each client shell imports the modules they need into `business-os.config.ts`, the framework wires them at boot. Zero, one, or many modules per install.

The first reference implementation is `@business-os/module-example` — useful as a copy-pasta target, not for client deployments.

## Module manifest (locked)

```ts
import type { z } from 'zod';

export interface ModuleManifest<TSettings extends z.ZodTypeAny> {
  /** kebab-case unique identifier within the install. */
  slug: string;
  /** semver of the module package. */
  version: string;
  /** Human-readable name shown in the operator UI's sidebar. */
  displayName: string;
  /** One-line description. */
  description: string;
  /** Per-install settings — auto-rendered as a form by core, same as agents. */
  settingsSchema: TSettings;
  /**
   * Absolute path to a directory of .sql migrations the module owns.
   * Forward-only, same runner as everything else. Omit if no schema.
   */
  migrationsDir?: string;
  /** Default audience tag for the module's UI pages + routes. */
  defaultAudience?: AudienceTag;
}
```

### Slug rules
- kebab-case, ASCII only, no leading digit. Pattern: `/^[a-z][a-z0-9-]*$/`.
- Unique within the install. The framework refuses to boot on collision.
- Used as: settings scope (`module:<slug>`), API URL prefix (`/api/modules/<slug>`), SPA URL prefix (`/modules/<slug>`), audit log fields, logger tag (`module_slug`).

### Versioning
- Module packages follow semver. Breaking schema or REST contract changes require a major bump.
- The framework records the running version in logs (`module_slug` + `module_version`) on boot. There is no compatibility matrix — the client shell pins versions in `package.json`.

## Server-side: `registerRoutes`

```ts
export type RegisterRoutes<TSettings = unknown> = (
  app: unknown, // FastifyInstance; typed as unknown so module-sdk stays runtime-neutral
  ctx: ModuleServerContext<TSettings>,
) => void | Promise<void>;

export interface ModuleServerContext<TSettings = unknown> {
  settings: TSettings;             // decrypted, parsed; defaults applied
  logger: ModuleLogger;            // pino child tagged with module_slug
}
```

### Mount path
- Routes are registered under a Fastify prefix of `/api/modules/<slug>` at boot.
- A route defined as `app.get('/items')` inside the module resolves at `/api/modules/inventory/items`.
- The framework does not strip or rewrite the prefix elsewhere.

### URL namespacing
The `/api/` prefix separates module API routes from SPA UI routes:
- API: `/api/modules/<slug>/<route>` — handled by Fastify, returns JSON.
- UI: `/modules/<slug>/<path>` — handled by react-router in the SPA, renders the module's React component.

Without the `/api/` prefix, both share the same path and a hard navigation to `/modules/inventory/items` (a typed URL, refresh, or bookmark) would hit the Fastify handler instead of falling through to the SPA. The original spec used `/modules/<slug>` for API; that turned out to be a bug and was fixed 2026-06-11.

### Auth
- Auth is shared with the rest of the framework. `requireUser` is available; `req.user` is populated. Modules opt in per-route, same as agents and connectors do today on their own routes.
- `defaultAudience` and per-page `audience` are *informational only* until the permissions PR lands (see Open questions).

### DB access
- Modules get the same Drizzle handle the framework uses (via `app.deps.db`).
- Modules **may** read their own tables, core tables, agent tables, and connector tables.
- Modules **must not** write to tables owned by another module. Cross-module data crosses through the other module's REST surface, same as agent → connector.
- This is convention, not enforced at the DB layer. A future "schema namespacing" pass may enforce it.

### Logging + audit
- The logger handed in `ctx.logger` is a pino child pre-tagged with `module_slug`. Use it.
- Every state-changing module route MUST write an audit-log row, same rule as agent routes. Use `req.audit(action, meta)` — `action` should be namespaced (`<slug>.<verb>` — e.g., `inventory.item.created`).

## UI: `uiPages[]`

```ts
export interface ModuleUiPage {
  path: string;                                       // subpath under /modules/<slug>/
  navLabel?: string;                                  // shown in sidebar if set
  Component: ComponentType<Record<string, never>>;    // React component
  audience?: AudienceTag;                             // per-page override
}
```

### Mount path
- The operator UI mounts each page at `/modules/<slug>/<path>`.
- `path: ''` means the module's index page (`/modules/<slug>`).
- When a module has no pages but is registered, `/modules/<slug>/*` falls back to `ModulePagePlaceholder` (a stub that lists the module's REST routes for the operator).

### Sidebar nav
- Pages with `navLabel` set are surfaced in the sidebar under the module's `displayName`.
- Pages without `navLabel` are reachable by direct URL only (detail pages, modals).

### Component shape
- React 18, function component, no props.
- `react` and `react-router-dom` are peer deps of the module (provided by the operator UI bundle).
- Module UI uses the same Tailwind tokens as the framework UI (`ink-*`, `accent`, `.card`, `.btn-*`, etc.). Module packages MUST be included in the install's `tailwind.config.js` content glob so utility classes are emitted (the create-client scaffolder handles this for shared modules; client shells add custom modules manually).
- Dark mode is automatic — modules MUST NOT hardcode light-only classes (`bg-white` without `dark:bg-ink-900`, etc.). See `packages/ui/src/styles.css` for the token system.

### Bundling
- Module UI is bundled by the client shell's `vite build`, not separately.
- The module's `package.json` MAY export a `./ui` subpath if it wants to keep its UI imports separate from server code. The example module does this:
  - `src/server/index.ts` (server) → `package.json#exports.["."]`
  - `src/ui/index.ts` (UI) → `package.json#exports.["./ui"]`
- This is a *convention*, not enforced by the SDK.

## Settings

Modules use the same auto-rendered settings form pattern as agents:

1. `manifest.settingsSchema` is a Zod schema with defaults.
2. Operator edits via `Settings → Modules → <displayName>` (auto-rendered).
3. Values persist to the `settings` table at scope `module:<slug>`.
4. At boot, core loads + validates settings (defaults applied) and passes the parsed object to `registerRoutes(app, ctx)` via `ctx.settings`.
5. Settings are *not* encrypted — modules use the framework's secrets store for credentials (same as connectors do).

Settings reload requires a process restart. (This matches agent behavior. Hot-reload of settings is out of scope for now.)

## Migrations

```ts
manifest.migrationsDir?: string  // absolute path to a dir of .sql files
```

- Forward-only `.sql` files, same runner as core (`@business-os/db`).
- Files named `NNNN_<description>.sql`, applied in lex order. Failure aborts boot.
- Each module's migrations are recorded in the migration table under owner `module:<slug>`.
- A module schema may freely reference core tables (`users`, `audit_log`, etc.) but MUST NOT touch other modules' tables (convention).

## Wiring at boot

The framework boots modules in this order:

1. **Migrations** — apply core + each agent + each connector + each module's pending migrations, owner-tagged.
2. **Routes** — register core auth routes → admin routes → agent routes → connector routes → **module routes** under `/api/modules/<slug>`.
3. **UI inventory** — `/api/modules` exposes the inventory to the operator UI shell (`{slug, version, displayName, description, uiPages[], settings, settingsSchema}`); the UI shell discovers nav entries from this.
4. **Scheduler** — agent schedules registered. Modules do not participate.

## Inventory + discovery

The client shell declares modules in `business-os.config.ts`:

```ts
import { inventoryModule } from '@business-os/module-inventory';
import { jobsModule } from '@business-os/module-jobs';

export default {
  agents: [...],
  connectors: [...],
  modules: [inventoryModule, jobsModule],
  ...
};
```

At boot, core builds an inventory (`packages/core/src/inventory.ts`) that exposes:

```ts
interface Inventory {
  listAgents(): AgentPackageLike[];
  listConnectors(): ConnectorPackageLike[];
  listModules?(): ModulePackageLike[];
  getModule?(slug: string): ModulePackageLike;
}
```

The operator UI shell calls `GET /api/modules` to populate its sidebar dynamically. There is no static UI module registry.

## Boundary rules (locked)

The framework already has these rules in CLAUDE.md for agents/connectors. Modules extend them:

- Framework packages (`packages/*`) MUST NOT import from any agent, connector, or module package — only their SDK interfaces.
- Agents MUST NOT import from other agents.
- Connectors MUST NOT import from agents or modules.
- **Modules MUST NOT import from other modules.** Cross-module data crosses through REST.
- **Modules MAY import `@business-os/agent-sdk` / `@business-os/connector-sdk` types** if they need to expose capability-shaped REST surfaces, but they are not agents and do not implement those interfaces.
- Modules MAY import `@business-os/module-sdk` (their own SDK) and `@business-os/api-contract` (shared Zod types).
- Client shells MAY import any `@business-os/*` package.

## When to use which primitive

A quick decision tree for "I need to add X":

- "I need to call a SaaS API on behalf of an agent." → **connector**.
- "I need a scheduled or event-driven workflow that pulls data and produces an outcome." → **agent**.
- "I need to *store and manage business state* (rows the operator edits, that agents query/mutate)." → **module**.
- "I need a one-off custom REST endpoint for this client only." → put it directly in the client shell's `business-os.config.ts` boot hook, or scaffold a per-client module in `agents/<slug>-<client>/` style.

Don't force a module when one of the above fits. A module is the heaviest of the three (own schema, own routes, own UI) and pays back when there is real state to manage.

## Worked example: `modules/example/`

The example module ships as a copy-pasta starting point. It demonstrates:

- `src/server/index.ts` — exports a `defineModule({...})`. Manifest has a Zod settings schema with one knob; `registerRoutes(app, ctx)` adds a `GET /ping` returning a settings-stamped response.
- `src/ui/index.ts` — exports a `uiPages` array with a single page at `path: ''` showing the settings + a "say hi" button that calls `/modules/example/ping`.
- `migrations/0001_example.sql` — creates one table to prove the migration runner picks it up.
- `package.json` — `exports` map splits `.` (server) and `./ui`. `devDependencies` keep `vite` etc. out of the server bundle.

It is NOT meant for deployment. Real modules go under names like `module-inventory`, `module-jobs`, `module-quotes`, etc.

## Open questions

- **Permissions / audience enforcement.** `defaultAudience` and per-page `audience` are recorded in the manifest but not enforced. The "permissions PR" (not yet open) will introduce a check at the route and UI-render layer. Until then, `requireUser` is the only gate.
- **Hot reload of module settings.** Currently requires process restart. Likely fine for the first N clients; reopen if it becomes painful.
- **Schema namespacing enforcement.** Right now "modules MUST NOT touch other modules' tables" is convention. Future PR could introduce per-module Postgres schemas (one schema per slug) to enforce it.
- **Inter-module dependency declarations.** Modules currently can't declare "I need module X to be installed." Real-world example: a `module-quotes` that wants to attach line items to `module-inventory` SKUs. For now, modules either soft-reference (look up via REST, no-op if missing) or document the dependency in their README.
- **Per-module rate limiting / route timeouts.** Out of scope. Modules inherit the global Fastify settings.

## What this spec does NOT cover

- The cost-visibility primitive — that's a cross-cutting concern across agents + connectors + (eventually) modules. Separate spec at [docs/specs/2026-06-09-cost-visibility.md](.) when it's written.
- Module marketplaces or third-party module distribution — out of scope for the foreseeable future per CLAUDE.md.
- Workflow/orchestration *across* modules — that belongs in agents.

## Migration / backfill

This spec documents the existing implementation. No code changes are required to ratify it — the contract above is already what `@business-os/module-sdk` enforces today. Future PRs that change the contract MUST update this spec in the same PR.
