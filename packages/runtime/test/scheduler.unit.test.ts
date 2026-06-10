import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { pino } from 'pino';
import { Registry } from '../src/registry.js';
import { Scheduler } from '../src/scheduler.js';

/**
 * Unit-level scheduler tests: don't touch real Postgres. Mock db.select()
 * with a small fixture that returns pre-seeded settings rows so the
 * enable/override read in start() resolves without hitting a server.
 * Actual run firing is covered in the scheduler.integration test.
 */

function fakeAgent(slug: string, schedule: { kind: 'cron'; expr: string } | { kind: 'manual' } | { kind: 'event'; topic: string }) {
  return {
    manifest: {
      slug,
      version: '0.0.1',
      displayName: slug,
      description: 'test',
      requiredConnectors: [] as const,
      settingsSchema: z.object({}),
      schedule,
    },
    run: async () => ({ ok: true, summary: 'noop' }),
  };
}

/**
 * Minimal stand-in for a Drizzle db that resolves
 *   db.select({...}).from(table)
 * to the seeded settings rows. We don't validate the column object — the
 * scheduler reads `.scope` and `.value` on the resulting rows, both of
 * which we set explicitly in the seed.
 */
function fakeDb(seed: Array<{ scope: string; value: unknown }>): never {
  const select = (): {
    from: (_t: unknown) => Promise<Array<{ scope: string; value: unknown }>>;
  } => ({
    from: async () => seed,
  });
  return { select } as unknown as never;
}

/** Convenience: seed agent-enabled rows for every slug. */
function enabledFor(...slugs: string[]): Array<{ scope: string; value: unknown }> {
  return slugs.map((s) => ({ scope: `agent-enabled:${s}`, value: { enabled: true } }));
}

describe('Scheduler.start mapping', () => {
  it('installs a cron job for cron-scheduled agents', async () => {
    const reg = new Registry();
    reg.registerAgent(fakeAgent('hourly', { kind: 'cron', expr: '0 * * * *' }));
    const s = new Scheduler({
      db: fakeDb(enabledFor('hourly')),
      registry: reg,
      connectors: { resolve: async () => null as never },
      logger: pino({ level: 'silent' }),
    });
    await s.start();
    expect(s._hasCron('hourly')).toBe(true);
    void s.stop();
  });

  it('builds an event subscriber map', async () => {
    const reg = new Registry();
    reg.registerAgent(fakeAgent('on-lead', { kind: 'event', topic: 'lead.created' }));
    reg.registerAgent(fakeAgent('also-on-lead', { kind: 'event', topic: 'lead.created' }));
    reg.registerAgent(fakeAgent('on-other', { kind: 'event', topic: 'order.placed' }));
    const s = new Scheduler({
      db: fakeDb(enabledFor('on-lead', 'also-on-lead', 'on-other')),
      registry: reg,
      connectors: { resolve: async () => null as never },
      logger: pino({ level: 'silent' }),
    });
    await s.start();
    expect(s._subscribers('lead.created')).toEqual(['on-lead', 'also-on-lead']);
    expect(s._subscribers('order.placed')).toEqual(['on-other']);
    expect(s._subscribers('unknown')).toEqual([]);
    void s.stop();
  });

  it('manual-scheduled agents install nothing', async () => {
    const reg = new Registry();
    reg.registerAgent(fakeAgent('on-demand', { kind: 'manual' }));
    const s = new Scheduler({
      db: fakeDb(enabledFor('on-demand')),
      registry: reg,
      connectors: { resolve: async () => null as never },
      logger: pino({ level: 'silent' }),
    });
    await s.start();
    expect(s._hasCron('on-demand')).toBe(false);
    expect(s._subscribers('on-demand')).toEqual([]);
    void s.stop();
  });

  it('disabled agents are skipped entirely', async () => {
    const reg = new Registry();
    reg.registerAgent(fakeAgent('hourly', { kind: 'cron', expr: '0 * * * *' }));
    const s = new Scheduler({
      // No enable row -> disabled (production default).
      db: fakeDb([]),
      registry: reg,
      connectors: { resolve: async () => null as never },
      logger: pino({ level: 'silent' }),
    });
    await s.start();
    expect(s._hasCron('hourly')).toBe(false);
    void s.stop();
  });

  it('operator override beats manifest schedule', async () => {
    const reg = new Registry();
    reg.registerAgent(fakeAgent('h', { kind: 'manual' }));
    const s = new Scheduler({
      db: fakeDb([
        ...enabledFor('h'),
        { scope: 'agent-schedule:h', value: { kind: 'cron', expr: '*/15 * * * *' } },
      ]),
      registry: reg,
      connectors: { resolve: async () => null as never },
      logger: pino({ level: 'silent' }),
    });
    await s.start();
    expect(s._hasCron('h')).toBe(true);
    void s.stop();
  });

  it('refuses double start', async () => {
    const reg = new Registry();
    const s = new Scheduler({
      db: fakeDb([]),
      registry: reg,
      connectors: { resolve: async () => null as never },
      logger: pino({ level: 'silent' }),
    });
    await s.start();
    await expect(s.start()).rejects.toThrow(/already started/);
    void s.stop();
  });

  it('throws on invalid cron expressions', async () => {
    const reg = new Registry();
    reg.registerAgent(fakeAgent('bad', { kind: 'cron', expr: 'not a cron' }));
    const s = new Scheduler({
      db: fakeDb(enabledFor('bad')),
      registry: reg,
      connectors: { resolve: async () => null as never },
      logger: pino({ level: 'silent' }),
    });
    await expect(s.start()).rejects.toThrow();
  });
});
