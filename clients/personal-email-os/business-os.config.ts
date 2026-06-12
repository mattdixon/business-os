/**
 * Personal Email — Business OS registry.
 *
 * Matt's personal-email install. Owns three inbox-triage agents (cleanup,
 * categorize, surface) against Office 365 (Outlook), Gmail, or any IMAP
 * mailbox. Provider per agent is picked in the operator UI.
 *
 * Every framework connector ships via `@frontrangesystems/business-os-connectors-all` —
 * the operator decides which ones are visible from the Providers admin
 * page, not by editing this file.
 */

import { Registry, Scheduler, createConnectorResolver } from '@frontrangesystems/business-os-runtime';
import {
  allFrameworkConnectors,
  allFrameworkConnectorMigrations,
} from '@frontrangesystems/business-os-connectors-all';

import cleanup from '@frontrangesystems/business-os-agent-inbox-cleanup';
import categorize from '@frontrangesystems/business-os-agent-inbox-categorize';
import surface from '@frontrangesystems/business-os-agent-inbox-surface';

import type { MigrationOwner } from '@frontrangesystems/business-os-db';

export function buildRegistry(): Registry {
  const registry = new Registry();

  // ---- Connectors ----
  registry.registerMany(allFrameworkConnectors);

  // ---- Agents ----
  registry.registerAgent(cleanup);
  registry.registerAgent(categorize);
  registry.registerAgent(surface);

  return registry;
}

export const extraMigrations: MigrationOwner[] = [
  ...allFrameworkConnectorMigrations,
];

export type { Registry, Scheduler };
export { createConnectorResolver };
