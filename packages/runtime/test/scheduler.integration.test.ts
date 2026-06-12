import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { pino } from 'pino';
import { agentRuns, connectorInstances, settings as settingsTable } from '@frontrangesystems/business-os-db';
import { eq } from 'drizzle-orm';
import { createSecretsStore } from '@frontrangesystems/business-os-core/secrets';
import { Registry } from '../src/registry.js';
import { createConnectorResolver } from '../src/active-connectors.js';
import { Scheduler } from '../src/scheduler.js';
import { freshDb, pgReachable, TEST_DATABASE_URL } from './_db.js';

const reachable = await pgReachable(TEST_DATABASE_URL);
const d = reachable ? describe : describe.skip;

if (!reachable) {
  // eslint-disable-next-line no-console
  console.warn(
    `[scheduler.integration] Skipping: Postgres unreachable at ${TEST_DATABASE_URL}.`,
  );
}

d('Scheduler (manual + event) integration', () => {
  let env: Awaited<ReturnType<typeof freshDb>>;
  let registry: Registry;
  let resolver: ReturnType<typeof createConnectorResolver>;
  let scheduler: Scheduler;
  const logger = pino({ level: 'silent' });

  beforeAll(async () => {
    env = await freshDb();
    registry = new Registry();
    registry.registerAgent({
      manifest: {
        slug: 'manual-job',
        version: '0.0.1',
        displayName: 'Manual',
        description: 't',
        requiredConnectors: [] as const,
        settingsSchema: z.object({}),
        schedule: { kind: 'manual' },
      },
      run: async (_ctx, input) => ({ ok: true, summary: 'manual ran', details: { input } }),
    });
    registry.registerAgent({
      manifest: {
        slug: 'on-lead',
        version: '0.0.1',
        displayName: 'OnLead',
        description: 't',
        requiredConnectors: [] as const,
        settingsSchema: z.object({}),
        schedule: { kind: 'event', topic: 'lead.created' },
      },
      run: async (_ctx, input) => ({ ok: true, summary: 'event ran', details: { input } }),
    });
    const secrets = createSecretsStore(env.db, new Uint8Array(randomBytes(32)));
    resolver = createConnectorResolver({ db: env.db, secrets, registry, logger });
    scheduler = new Scheduler({ db: env.db, registry, connectors: resolver, logger });
    scheduler.start();
  });

  afterAll(async () => {
    await scheduler.stop();
    await env.sql.end({ timeout: 1 });
  });

  it('triggerManual records an agent_runs row with the manual trigger', async () => {
    await scheduler.triggerManual('manual-job', { x: 1 }, 'matt');
    const rows = await env.db.select().from(agentRuns).where(eq(agentRuns.agentSlug, 'manual-job'));
    expect(rows.length).toBe(1);
    expect(rows[0]!.trigger).toBe('manual:matt');
    expect(rows[0]!.ok).toBe(true);
  });

  it('fireEvent dispatches to every subscriber of a topic', async () => {
    await scheduler.fireEvent('lead.created', { id: 'lead-1' });
    const rows = await env.db.select().from(agentRuns).where(eq(agentRuns.agentSlug, 'on-lead'));
    expect(rows.length).toBe(1);
    expect(rows[0]!.trigger).toBe('event:lead.created');
  });

  it('fireEvent on an unknown topic is a no-op', async () => {
    await scheduler.fireEvent('no.such.topic', {});
    const allRows = await env.db.select().from(agentRuns);
    // Only the prior two should exist.
    expect(allRows.length).toBe(2);
  });

  // Suppress unused-variable for the placeholder DB writes used in other tests.
  void connectorInstances;
  void settingsTable;
});
