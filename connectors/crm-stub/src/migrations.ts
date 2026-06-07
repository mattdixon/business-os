import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MigrationOwner } from '@business-os/db';

const here = dirname(fileURLToPath(import.meta.url));

/** Migration owner shipped by connector-crm-stub. Add to client-starter's extraMigrations. */
export const crmStubMigrations: MigrationOwner = {
  owner: '@business-os/connector-crm-stub',
  dir: resolve(here, '..', 'migrations'),
};
