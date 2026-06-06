import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { pino } from 'pino';
import { Registry } from '../src/registry.js';
import { Scheduler } from '../src/scheduler.js';

/**
 * Unit-level scheduler tests: don't touch the DB. We pass null-ish deps and
 * verify the schedule -> cron / event mapping. Actual run firing is covered in
 * the integration test against real Postgres.
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

describe('Scheduler.start mapping', () => {
  it('installs a cron job for cron-scheduled agents', () => {
    const reg = new Registry();
    reg.registerAgent(fakeAgent('hourly', { kind: 'cron', expr: '0 * * * *' }));
    const s = new Scheduler({
      db: {} as never,
      registry: reg,
      connectors: { resolve: async () => null as never },
      logger: pino({ level: 'silent' }),
    });
    s.start();
    expect(s._hasCron('hourly')).toBe(true);
    void s.stop();
  });

  it('builds an event subscriber map', () => {
    const reg = new Registry();
    reg.registerAgent(fakeAgent('on-lead', { kind: 'event', topic: 'lead.created' }));
    reg.registerAgent(fakeAgent('also-on-lead', { kind: 'event', topic: 'lead.created' }));
    reg.registerAgent(fakeAgent('on-other', { kind: 'event', topic: 'order.placed' }));
    const s = new Scheduler({
      db: {} as never,
      registry: reg,
      connectors: { resolve: async () => null as never },
      logger: pino({ level: 'silent' }),
    });
    s.start();
    expect(s._subscribers('lead.created')).toEqual(['on-lead', 'also-on-lead']);
    expect(s._subscribers('order.placed')).toEqual(['on-other']);
    expect(s._subscribers('unknown')).toEqual([]);
    void s.stop();
  });

  it('manual-scheduled agents install nothing', () => {
    const reg = new Registry();
    reg.registerAgent(fakeAgent('on-demand', { kind: 'manual' }));
    const s = new Scheduler({
      db: {} as never,
      registry: reg,
      connectors: { resolve: async () => null as never },
      logger: pino({ level: 'silent' }),
    });
    s.start();
    expect(s._hasCron('on-demand')).toBe(false);
    expect(s._subscribers('on-demand')).toEqual([]);
    void s.stop();
  });

  it('refuses double start', () => {
    const reg = new Registry();
    const s = new Scheduler({
      db: {} as never,
      registry: reg,
      connectors: { resolve: async () => null as never },
      logger: pino({ level: 'silent' }),
    });
    s.start();
    expect(() => s.start()).toThrow(/already started/);
    void s.stop();
  });

  it('throws on invalid cron expressions', () => {
    const reg = new Registry();
    reg.registerAgent(fakeAgent('bad', { kind: 'cron', expr: 'not a cron' }));
    const s = new Scheduler({
      db: {} as never,
      registry: reg,
      connectors: { resolve: async () => null as never },
      logger: pino({ level: 'silent' }),
    });
    expect(() => s.start()).toThrow();
  });
});
