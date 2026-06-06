import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Sql } from 'postgres';

/**
 * Forward-only migration runner.
 *
 * Each owner (the framework core, every agent, every connector) has its own
 * directory of `.sql` files named like `0001_init.sql`, `0002_add_thing.sql`.
 * The runner:
 *   1. Ensures `migrations_applied` exists.
 *   2. For each owner, lists files lexicographically.
 *   3. Skips any (owner, name) already applied, AFTER comparing checksums to
 *      detect drift. A drifted migration is a hard error.
 *   4. Applies remaining migrations inside a single transaction per file and
 *      records them.
 *
 * There is no rollback. Forward-only by policy.
 */

export interface MigrationOwner {
  /** Identifier recorded in migrations_applied, e.g. "@business-os/db" */
  owner: string;
  /** Absolute path to a directory containing 0001_*.sql, 0002_*.sql, ... */
  dir: string;
}

export interface MigrationRunResult {
  applied: Array<{ owner: string; name: string }>;
  skipped: Array<{ owner: string; name: string }>;
}

const TRACKER_SQL = `
  CREATE TABLE IF NOT EXISTS migrations_applied (
    owner       TEXT NOT NULL,
    name        TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    checksum    TEXT NOT NULL,
    PRIMARY KEY (owner, name)
  );
`;

function checksum(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function listMigrations(dir: string): Promise<string[]> {
  if (!(await isDirectory(dir))) return [];
  const entries = await readdir(dir);
  return entries.filter((f) => f.endsWith('.sql')).sort();
}

export async function runMigrations(
  sql: Sql,
  owners: MigrationOwner[],
): Promise<MigrationRunResult> {
  await sql.unsafe(TRACKER_SQL);

  const applied: MigrationRunResult['applied'] = [];
  const skipped: MigrationRunResult['skipped'] = [];

  for (const { owner, dir } of owners) {
    const files = await listMigrations(dir);
    for (const file of files) {
      const name = file.replace(/\.sql$/, '');
      const body = await readFile(join(resolve(dir), file), 'utf8');
      const sum = checksum(body);

      const existing = await sql<{ checksum: string }[]>`
        SELECT checksum FROM migrations_applied
        WHERE owner = ${owner} AND name = ${name}
      `;
      if (existing.length > 0) {
        const prev = existing[0]!;
        if (prev.checksum !== sum) {
          throw new Error(
            `Migration drift: ${owner}/${name} on disk does not match the applied checksum. ` +
              `Migrations are forward-only — write a new migration instead of editing this one.`,
          );
        }
        skipped.push({ owner, name });
        continue;
      }

      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`
          INSERT INTO migrations_applied (owner, name, checksum)
          VALUES (${owner}, ${name}, ${sum})
        `;
      });
      applied.push({ owner, name });
    }
  }

  return { applied, skipped };
}
