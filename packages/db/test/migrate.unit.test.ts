import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/migrate.js';

/**
 * Unit-ish coverage of the runner using a stub Sql object — verifies the
 * scan/order/skip logic without needing a real database.
 * The real-DB integration test is in migrate.integration.test.ts.
 */

interface Call {
  kind: 'tracker' | 'select' | 'apply' | 'record';
  payload?: unknown;
}

function makeStubSql(initialApplied: Array<{ owner: string; name: string; checksum: string }>) {
  const applied = [...initialApplied];
  const calls: Call[] = [];

  const tx = {
    unsafe: async (body: string) => {
      calls.push({ kind: 'apply', payload: body });
    },
  } as any;
  // Calling tx as a tag function records the insert.
  const txTag = (..._args: unknown[]) => {
    calls.push({ kind: 'record', payload: _args });
    return Promise.resolve([]);
  };
  Object.assign(tx, { call: txTag });

  const sql: any = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (/SELECT checksum FROM migrations_applied/i.test(text)) {
      calls.push({ kind: 'select', payload: values });
      const [owner, name] = values as [string, string];
      const row = applied.find((a) => a.owner === owner && a.name === name);
      return Promise.resolve(row ? [{ checksum: row.checksum }] : []);
    }
    return Promise.resolve([]);
  };
  sql.unsafe = async (body: string) => {
    if (/CREATE TABLE IF NOT EXISTS migrations_applied/i.test(body)) {
      calls.push({ kind: 'tracker' });
    } else {
      calls.push({ kind: 'apply', payload: body });
    }
  };
  // Stub `sql.begin(cb)` — execute the callback against a sub-sql that records.
  sql.begin = async (cb: (tx: any) => Promise<void>) => {
    const txSql: any = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      if (/INSERT INTO migrations_applied/i.test(text)) {
        const [owner, name, checksum] = values as [string, string, string];
        applied.push({ owner, name, checksum });
        calls.push({ kind: 'record', payload: { owner, name, checksum } });
      }
      return Promise.resolve([]);
    };
    txSql.unsafe = async (body: string) => {
      calls.push({ kind: 'apply', payload: body });
    };
    await cb(txSql);
  };

  return { sql, calls, applied };
}

describe('runMigrations (unit, no DB)', () => {
  it('creates the tracker, applies in lexical order, then skips on re-run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'biz-os-unit-'));
    await writeFile(join(dir, '0002_second.sql'), 'SELECT 2;', 'utf8');
    await writeFile(join(dir, '0001_first.sql'), 'SELECT 1;', 'utf8');

    const { sql, calls } = makeStubSql([]);
    const first = await runMigrations(sql, [{ owner: 'test', dir }]);

    expect(first.applied.map((a) => a.name)).toEqual(['0001_first', '0002_second']);
    expect(calls.some((c) => c.kind === 'tracker')).toBe(true);

    // Second run: same on-disk state, already-applied list grew, so skipped.
    const second = await runMigrations(sql, [{ owner: 'test', dir }]);
    expect(second.applied).toHaveLength(0);
    expect(second.skipped.map((s) => s.name)).toEqual(['0001_first', '0002_second']);
  });

  it('throws on checksum drift', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'biz-os-unit-'));
    await writeFile(join(dir, '0001_x.sql'), 'SELECT 1;', 'utf8');

    const { sql } = makeStubSql([
      { owner: 'test', name: '0001_x', checksum: 'wrong-hash' },
    ]);
    await expect(runMigrations(sql, [{ owner: 'test', dir }])).rejects.toThrow(/drift/i);
  });
});
