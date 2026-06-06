import postgres, { type Sql, type Options } from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

export interface CreateDbOptions {
  url: string;
  /** Pool size. Defaults to 10 (matches Fastify default request concurrency). */
  max?: number;
  /** Forwarded to postgres-js for tests that want eager close. */
  pgOptions?: Options<Record<string, never>>;
}

/**
 * Build the postgres-js client + drizzle wrapper.
 * Returns both so callers can run raw SQL when they need to (migrations,
 * advisory locks, listen/notify) without going through drizzle.
 */
export function createDb(opts: CreateDbOptions): { db: Db; sql: Sql } {
  const sql = postgres(opts.url, {
    max: opts.max ?? 10,
    ...opts.pgOptions,
  });
  const db = drizzle(sql, { schema });
  return { db, sql };
}
