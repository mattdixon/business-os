import postgres from 'postgres';

/**
 * Test helper: determine whether a Postgres is reachable.
 *
 * Per CLAUDE.md: "Integration tests hit real Postgres in Docker — no DB mocks."
 * When DATABASE_URL is unset OR unreachable, integration tests skip with a clear
 * message. They never fall back to a mock.
 */
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

/**
 * Wipe every table in the current schema. Used at the start of each
 * integration test to keep the DB deterministic.
 *
 * Safer than DROP SCHEMA + recreate because it preserves the search path
 * and avoids racing with other connections.
 */
export async function truncateAll(url: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    const tables = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    if (tables.length === 0) return;
    const list = tables.map((t) => `"${t.tablename}"`).join(', ');
    await sql.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

/**
 * Drop every table — used by tests that want to re-run migrations from scratch.
 */
export async function dropAll(url: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  } finally {
    await sql.end({ timeout: 1 });
  }
}
