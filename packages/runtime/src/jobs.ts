import PgBoss from 'pg-boss';
import type { Logger } from 'pino';
import type { EnqueueOpts } from '@business-os/agent-sdk';
import type { Registry } from './registry.js';
import type { ConnectorResolver } from './active-connectors.js';
import { runAgent } from './run.js';
import type { Db } from '@business-os/db';

/**
 * Durable background jobs.
 *
 * Per CLAUDE.md: "Background jobs: pg-boss in the client's DB. Worker is the
 * same binary as the API with --worker flag."
 *
 * Two routing modes for enqueued jobs:
 *
 *   1. Job name === an agent slug: handled by runAgent() on the worker.
 *      `await ctx.jobs.enqueue('leadgen', { seed: 'concrete contractors' })`
 *      The agent shows up in agent_runs with trigger="event:job:<name>".
 *
 *   2. Job name is anything else: routed to a custom handler the client shell
 *      may have registered via `jobs.subscribe(name, handler)`. Useful for
 *      ad-hoc periodic work the operator doesn't want as a full agent yet.
 *
 * Either way: pg-boss persists the job, retries on failure (per pg-boss
 * defaults), supports delayed dispatch via `opts.delayMs`, and supports
 * idempotency via `opts.idempotencyKey` (mapped to pg-boss's singletonKey).
 */

export interface JobsBackend {
  /** Enqueue a named job with payload. */
  enqueue(name: string, payload: unknown, opts?: EnqueueOpts): Promise<string>;
  /** Register a custom job handler (non-agent names only). */
  subscribe(
    name: string,
    handler: (payload: unknown) => Promise<void>,
  ): Promise<void>;
  /** Start consumers — agent-routing + custom subscribers. Idempotent. */
  start(): Promise<void>;
  /** Stop consumers and close the pg-boss connection. */
  stop(): Promise<void>;
}

export interface JobsDeps {
  /** Postgres connection string. pg-boss creates its own pool. */
  databaseUrl: string;
  db: Db;
  registry: Registry;
  connectors: ConnectorResolver;
  logger: Logger;
}

export function createJobsBackend(deps: JobsDeps): JobsBackend {
  const boss = new PgBoss({
    connectionString: deps.databaseUrl,
    // pg-boss creates its own schema (`pgboss`) — keeps it cleanly separated
    // from the framework's `public` schema.
  });

  // Custom (non-agent) handlers registered by the client shell.
  const customHandlers = new Map<string, (payload: unknown) => Promise<void>>();
  let started = false;

  return {
    async enqueue(name, payload, opts): Promise<string> {
      if (!started) await this.start();
      const sendOpts: PgBoss.SendOptions = {};
      if (opts?.delayMs && opts.delayMs > 0) {
        sendOpts.startAfter = Math.ceil(opts.delayMs / 1000);
      }
      if (opts?.idempotencyKey) {
        sendOpts.singletonKey = opts.idempotencyKey;
      }
      const id = await boss.send(name, payload as object, sendOpts);
      if (!id) {
        // pg-boss returns null when a singletonKey collides with an existing job.
        deps.logger.info(
          { name, idempotencyKey: opts?.idempotencyKey },
          'jobs.enqueue.deduped',
        );
        return `deduped:${opts?.idempotencyKey ?? ''}`;
      }
      return id;
    },

    async subscribe(name, handler): Promise<void> {
      customHandlers.set(name, handler);
      if (started) {
        // Late subscription — register immediately.
        await registerCustomHandler(boss, name, handler);
      }
    },

    async start(): Promise<void> {
      if (started) return;
      await boss.start();
      started = true;

      // Register agent-routing worker for every agent slug in the registry.
      for (const agent of deps.registry.listAgents()) {
        const slug = agent.manifest.slug;
        await boss.work<unknown>(slug, async (jobs) => {
          for (const job of jobs) {
            await runAgent(
              {
                db: deps.db,
                registry: deps.registry,
                connectors: deps.connectors,
                logger: deps.logger,
              },
              slug,
              job.data,
              { kind: 'event', detail: `job:${slug}` },
            );
          }
        });
      }

      for (const [name, handler] of customHandlers) {
        await registerCustomHandler(boss, name, handler);
      }
      deps.logger.info(
        { customHandlers: customHandlers.size, agentWorkers: deps.registry.listAgents().length },
        'jobs.started',
      );
    },

    async stop(): Promise<void> {
      if (!started) return;
      await boss.stop({ graceful: true });
      started = false;
    },
  };
}

async function registerCustomHandler(
  boss: PgBoss,
  name: string,
  handler: (payload: unknown) => Promise<void>,
): Promise<void> {
  await boss.work<unknown>(name, async (jobs) => {
    for (const job of jobs) {
      await handler(job.data);
    }
  });
}
