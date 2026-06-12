import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { MigrationOwner } from './migrate.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The framework core owner — the migrations bundled with @frontrangesystems/business-os-db
 * itself. Agents and connectors add their own MigrationOwner entries when the
 * runtime boots.
 */
export const coreMigrations: MigrationOwner = {
  // Internal migration tracking string. Kept as the legacy '@business-os/db'
  // even after the npm rename to '@frontrangesystems/business-os-db' — this
  // is the row key in migrations_applied and renaming it would break every
  // existing database.
  owner: '@business-os/db',
  // src/ at dev time, dist/ when built. Migrations are shipped at the package root.
  dir: resolve(here, '..', 'migrations'),
};
