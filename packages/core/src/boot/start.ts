import {
  createDb,
  runMigrations,
  coreMigrations,
  type MigrationOwner,
} from '@business-os/db';
import { buildApp, type AppDeps } from '../app.js';
import { createSecretsStore, loadSecretsKey } from '../secrets/index.js';
import { parseEnv, type FrameworkEnv } from './env.js';
import type { AgentInventory, ManualTriggerer } from '../inventory.js';

/**
 * The framework's entry point. A client shell's index.ts does:
 *
 *   import { startServer } from '@business-os/core';
 *   import { Registry, Scheduler, createConnectorResolver } from '@business-os/runtime';
 *   import leadgen from '@business-os/agent-leadgen';
 *   import anthropic from '@business-os/connector-anthropic';
 *
 *   const registry = new Registry();
 *   registry.registerAgent(leadgen);
 *   registry.registerConnectorProvider(anthropic);
 *
 *   await startServer({
 *     env: process.env,
 *     inventory: registry,
 *     mode: process.argv.includes('--worker') ? 'worker' : 'api',
 *     // Optional: a function that returns a Scheduler-like trigger. We can't
 *     // import @business-os/runtime here without creating a cycle, so the
 *     // client constructs it and passes it in.
 *     trigger: (deps) => makeScheduler(deps),
 *     // Optional: agents and connectors may ship their own migration owners.
 *     migrations: [...leadgen.migrations, ...anthropic.migrations],
 *   });
 *
 * Modes:
 *   - 'api'    : Fastify listens on API_PORT. Scheduler is NOT started.
 *   - 'worker' : Scheduler is started; no HTTP listener. Use for the
 *                background-job process.
 *   - 'both'   : Single-process dev convenience — Fastify + Scheduler.
 */

export type StartMode = 'api' | 'worker' | 'both';

export interface StartServerOpts {
  /** Process env. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Inventory of registered agents + connector providers. */
  inventory: AgentInventory;
  /**
   * Optional trigger factory. The runtime's Scheduler implements this; if
   * omitted, manual-run endpoints return 503.
   */
  triggerFactory?: (deps: { startScheduler: boolean }) => ManualTriggerer & {
    start?: () => void;
    stop?: () => Promise<void>;
  };
  /**
   * Extra migration owners contributed by agents + connectors. The framework's
   * coreMigrations are always run first.
   */
  migrations?: MigrationOwner[];
  /**
   * 'api' | 'worker' | 'both'. Default: 'both' in development, 'api' otherwise.
   */
  mode?: StartMode;
  /** Override the issuer label shown in TOTP enrollment. */
  issuer?: string;
  /** Override AppDeps (escape hatch for tests). Don't use in production. */
  overrideAppDeps?: Partial<AppDeps>;
}

export interface StartedServer {
  env: FrameworkEnv;
  url?: string;
  /** Returns when the process should exit. Idempotent. */
  shutdown: () => Promise<void>;
}

export async function startServer(opts: StartServerOpts): Promise<StartedServer> {
  const env = parseEnv(opts.env);
  const mode: StartMode = opts.mode ?? (env.NODE_ENV === 'development' ? 'both' : 'api');

  const { db, sql } = createDb({ url: env.DATABASE_URL });

  const owners: MigrationOwner[] = [coreMigrations, ...(opts.migrations ?? [])];
  const applied = await runMigrations(sql, owners);
  if (applied.applied.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[startServer] applied ${applied.applied.length} migration(s): ` +
        applied.applied.map((a) => `${a.owner}/${a.name}`).join(', '),
    );
  }

  const encryptionKey = loadSecretsKey({ SECRETS_KEY: env.SECRETS_KEY });
  const secrets = createSecretsStore(db, encryptionKey);

  const trigger = opts.triggerFactory?.({
    startScheduler: mode === 'worker' || mode === 'both',
  });
  if (trigger?.start && (mode === 'worker' || mode === 'both')) {
    trigger.start();
  }

  // API process
  let url: string | undefined;
  const app =
    mode === 'worker'
      ? undefined
      : buildApp({
          db,
          secrets,
          encryptionKey,
          clientSlug: env.CLIENT_SLUG,
          issuer: opts.issuer ?? env.CLIENT_NAME,
          cookieSecure: env.NODE_ENV === 'production',
          inventory: opts.inventory,
          trigger,
          ...opts.overrideAppDeps,
        });
  if (app) {
    await app.listen({ host: '0.0.0.0', port: env.API_PORT });
    url = `http://0.0.0.0:${env.API_PORT}`;
    app.log.info({ mode, port: env.API_PORT }, 'business-os: api listening');
  } else {
    // eslint-disable-next-line no-console
    console.log(`[startServer] worker-only mode; scheduler running`);
  }

  let stopped = false;
  const shutdown = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (app) await app.close().catch(() => {});
    if (trigger?.stop) await trigger.stop().catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
  };

  return { env, url, shutdown };
}
