import type { z } from 'zod';
import type { ComponentType } from 'react';

/**
 * Module — the third framework primitive, alongside agents and connectors.
 *
 *   - **Agent**: pull, summarize, propose, audit. Async, episodic.
 *   - **Connector**: talks to a system outside this install on agents' behalf.
 *   - **Module**: owns a slice of business state — its own tables, REST routes,
 *     and (optionally) UI pages. Agents read/write a module's data via its
 *     REST surface, just like agents call connectors.
 *
 * A module is **standalone**: an install can have zero modules, one, or N.
 * Modules don't reach into each other's tables; they cross-talk through their
 * REST routes the same way an agent would.
 *
 * Example shape (no business logic — see modules/example/):
 *   defineModule({
 *     manifest: {
 *       slug: 'inventory',
 *       version: '0.0.1',
 *       displayName: 'Inventory',
 *       description: 'Tracks SKUs, on-hand counts, reorder points.',
 *       settingsSchema: z.object({ defaultReorderDays: z.number().default(14) }),
 *       migrationsDir: resolve(here, '..', 'migrations'),
 *     },
 *     registerRoutes: (app, ctx) => {
 *       app.get('/items', async () => ctx.db.select().from(items));
 *       app.post('/items', async (req) => ctx.db.insert(items).values(req.body));
 *     },
 *     uiPages: [
 *       { path: '', navLabel: 'Items', Component: ItemsList },
 *       { path: 'low-stock', navLabel: 'Low stock', Component: LowStock },
 *     ],
 *   });
 */

/**
 * Audience tag — same shape used elsewhere for permissions. A module page can
 * declare its default audience; operators can override per install. Until the
 * permissions PR lands, audience is informational only.
 */
export type AudienceTag =
  | { kind: 'everyone' }
  | { kind: 'admins' }
  | { kind: 'departments'; departments: string[] };

export interface ModuleManifest<TSettings extends z.ZodTypeAny = z.ZodTypeAny> {
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
   * Forward-only, same runner as everything else. Omit if the module has
   * no schema.
   */
  migrationsDir?: string;
  /** Default audience tag for the module's UI pages + routes. */
  defaultAudience?: AudienceTag;
}

/**
 * Context handed to the module's server-side registerRoutes.
 *
 * Routes are mounted under `/api/modules/<slug>` by core (e.g. a route defined as
 * `app.get('/items')` resolves at `/api/modules/inventory/items`). The /api/
 * prefix keeps API routes from colliding with SPA routes. Auth is shared
 * with the rest of the framework; req.user is populated.
 *
 * `db` is the same Drizzle handle the framework uses — modules can read their
 * own tables freely and can read core/agent/connector tables too if needed.
 * Modules MUST NOT touch other modules' tables directly; cross-module data
 * crosses through the REST surface.
 */
export interface ModuleServerContext<TSettings = unknown> {
  /** Decrypted, parsed module settings (validated against the manifest schema). */
  settings: TSettings;
  /** Module-scoped logger pre-tagged with `module_slug`. */
  logger: ModuleLogger;
}

export interface ModuleLogger {
  trace(obj: object | string, msg?: string): void;
  debug(obj: object | string, msg?: string): void;
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
}

/**
 * Function shape modules export to register their REST routes. Receives the
 * Fastify-typed app instance + module context.
 *
 * We type the app as `unknown` here so module-sdk doesn't depend on Fastify
 * directly (keeps the SDK runtime-neutral; modules import their own Fastify
 * types if they want them).
 */
export type RegisterRoutes<TSettings = unknown> = (
  app: unknown,
  ctx: ModuleServerContext<TSettings>,
) => void | Promise<void>;

/**
 * A UI page a module contributes. The operator UI sticks these under
 * `/modules/<slug>/<path>` in its router and renders the Component there.
 *
 * The Component is a React component; the module-sdk lists `react` as a peer
 * dep (via the UI bundler) but does not import from it at runtime.
 */
export interface ModuleUiPage {
  /**
   * Subpath within the module. Empty string means the module's index page.
   * No leading slash.
   */
  path: string;
  /**
   * Label in the operator UI's sidebar. When omitted the page is reachable
   * via direct URL but not in the nav (useful for detail pages).
   */
  navLabel?: string;
  /** React component rendered inside the operator shell. */
  Component: ComponentType<Record<string, never>>;
  /** Override the module's defaultAudience for this specific page. */
  audience?: AudienceTag;
}

export interface ModulePackage<TSettings extends z.ZodTypeAny = z.ZodTypeAny> {
  manifest: ModuleManifest<TSettings>;
  /**
   * Register Fastify routes for this module. Called once at boot. Optional —
   * a module can be UI-only.
   */
  registerRoutes?: RegisterRoutes<z.infer<TSettings>>;
  /**
   * UI pages this module contributes. Optional — a module can be
   * server-only.
   */
  uiPages?: ModuleUiPage[];
}

/**
 * Helper: defines a module so TSettings is inferred from the manifest's
 * settingsSchema. Same pattern as defineAgent / defineConnector.
 */
export function defineModule<TSettings extends z.ZodTypeAny>(
  pkg: ModulePackage<TSettings>,
): ModulePackage<TSettings> {
  return pkg;
}
