import postgres from 'postgres';
import { createDb, runMigrations, coreMigrations } from '@business-os/db';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://businessos:businessos@localhost:4732/businessos_dev';

export async function pgReachable(url: string): Promise<boolean> {
  const sql = postgres(url, { max: 1, idle_timeout: 1, connect_timeout: 2 });
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export async function freshDb() {
  const wipe = postgres(TEST_DATABASE_URL, { max: 1 });
  try {
    await wipe.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  } finally {
    await wipe.end({ timeout: 1 });
  }
  const { db, sql } = createDb({ url: TEST_DATABASE_URL });
  await runMigrations(sql, [coreMigrations]);
  return { db, sql, url: TEST_DATABASE_URL };
}
