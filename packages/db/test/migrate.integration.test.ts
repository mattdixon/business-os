import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { resolve } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/migrate.js';
import { coreMigrations } from '../src/owners.js';
import { TEST_DATABASE_URL, pgReachable, dropAll } from './_pg.js';

const reachable = await pgReachable(TEST_DATABASE_URL);
const d = reachable ? describe : describe.skip;

if (!reachable) {
  // eslint-disable-next-line no-console
  console.warn(
    `[db.integration] Skipping: Postgres unreachable at ${TEST_DATABASE_URL}. ` +
      `Start it with \`docker compose up -d postgres\` to run these tests.`,
  );
}

d('migration runner (real Postgres)', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    await dropAll(TEST_DATABASE_URL);
    sql = postgres(TEST_DATABASE_URL, { max: 2 });
  });

  afterAll(async () => {
    await sql.end({ timeout: 1 });
  });

  it('applies core migrations and is idempotent', async () => {
    const first = await runMigrations(sql, [coreMigrations]);
    expect(first.applied.map((a) => a.name)).toContain('0001_init');
    expect(first.skipped).toHaveLength(0);

    const second = await runMigrations(sql, [coreMigrations]);
    expect(second.applied).toHaveLength(0);
    expect(second.skipped.map((s) => s.name)).toContain('0001_init');

    // Spot-check: a known core table exists.
    const tables = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    const names = new Set(tables.map((t) => t.tablename));
    for (const t of [
      'users',
      'sessions',
      'password_reset_tokens',
      'secrets',
      'settings',
      'connector_instances',
      'audit_log',
      'agent_runs',
      'migrations_applied',
    ]) {
      expect(names.has(t)).toBe(true);
    }
  });

  it('detects checksum drift', async () => {
    // Make a tiny custom owner, apply it, then mutate it on disk.
    const dir = await mkdtemp(join(tmpdir(), 'biz-os-drift-'));
    try {
      const file = join(dir, '0001_drift.sql');
      await writeFile(file, 'CREATE TABLE drift_a (id int);', 'utf8');
      const owner = { owner: 'test:drift', dir };

      const first = await runMigrations(sql, [owner]);
      expect(first.applied).toHaveLength(1);

      await writeFile(file, 'CREATE TABLE drift_a (id bigint);', 'utf8');
      await expect(runMigrations(sql, [owner])).rejects.toThrow(/drift/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not lose data from earlier migrations when a later one runs', async () => {
    // Insert a row using the core schema, then run again — row must survive.
    const userInsert = await sql`
      INSERT INTO users (email, password_hash) VALUES ('test@example.com', 'argon2-dummy')
      RETURNING id
    `;
    expect(userInsert.length).toBe(1);

    await runMigrations(sql, [coreMigrations]);

    const rows = await sql`SELECT email FROM users WHERE email = 'test@example.com'`;
    expect(rows.length).toBe(1);
  });
});

// Make sure unused import is harmless in the resolve path
void resolve;
