import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { MigrationOwner } from './migrate.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The framework core owner — the migrations bundled with @business-os/db
 * itself. Agents and connectors add their own MigrationOwner entries when the
 * runtime boots.
 */
export const coreMigrations: MigrationOwner = {
  owner: '@business-os/db',
  // src/ at dev time, dist/ when built. Migrations are shipped at the package root.
  dir: resolve(here, '..', 'migrations'),
};
