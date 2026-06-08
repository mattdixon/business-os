import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { settings as settingsTable } from '@business-os/db';
import type { AppDeps } from './app.js';
import type { ModulePackageLike } from './inventory.js';

/**
 * Server-side wiring for modules.
 *
 * For each module in the inventory:
 *   1. Load its persisted settings from the `settings` table
 *      (scope = `module:<slug>`), validate against the manifest schema,
 *      use defaults if no row exists.
 *   2. Build a module-scoped logger (pino child tagged with module_slug).
 *   3. Register the module's routes under a Fastify prefix
 *      `/modules/<slug>` so a `app.get('/items')` in the module renders at
 *      `/modules/inventory/items`.
 *
 * Cross-module isolation is by convention: modules may read/write only their
 * own tables. We don't enforce it at the DB layer.
 */

const SETTINGS_SCOPE = (slug: string): string => `module:${slug}`;

export async function registerModuleRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  if (!deps.inventory?.listModules) return;
  const modules = deps.inventory.listModules();
  for (const mod of modules) {
    if (!mod.registerRoutes) continue;

    const settings = await loadModuleSettings(deps, mod);
    const childLogger = app.log.child({ module_slug: mod.manifest.slug });

    await app.register(
      async (scope) => {
        // Cast through unknown — the module-sdk types `app` as unknown to stay
        // runtime-neutral. Inside this closure it's a normal FastifyInstance.
        await Promise.resolve(
          (mod.registerRoutes as (a: unknown, c: unknown) => void | Promise<void>)(scope, {
            settings,
            logger: childLogger,
          }),
        );
      },
      { prefix: `/modules/${mod.manifest.slug}` },
    );
    app.log.info(
      { module: mod.manifest.slug },
      'module routes registered',
    );
  }
}

async function loadModuleSettings(
  deps: AppDeps,
  mod: ModulePackageLike,
): Promise<unknown> {
  const rows = await deps.db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.scope, SETTINGS_SCOPE(mod.manifest.slug)))
    .limit(1);
  const raw = rows[0]?.value ?? {};
  // Module manifests carry Zod schemas; parse with defaults applied.
  const parsed = (mod.manifest.settingsSchema as { parse: (v: unknown) => unknown }).parse(raw);
  return parsed;
}
