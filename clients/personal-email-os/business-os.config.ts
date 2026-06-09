/**
 * Personal Email — Business OS registry.
 *
 * Matt's personal-email install. Owns three inbox-triage agents (cleanup,
 * categorize, surface) against Office 365 (Outlook), Gmail, or any IMAP
 * mailbox. Provider per agent is picked in the operator UI.
 *
 * Per-agent / per-connector schedules, credentials, on/off, and per-run
 * settings live in the DB and are managed in the operator UI — NOT here.
 */

import { Registry, Scheduler } from '@business-os/runtime';
import { createConnectorResolver } from '@business-os/runtime';

// LLM providers.
import anthropic from '@business-os/connector-anthropic';
import openai from '@business-os/connector-openai';

// Inbox providers (email-inbox capability). Operator picks one per agent.
import outlookInbox from '@business-os/connector-email-inbox-outlook-composio';
import gmailInbox from '@business-os/connector-email-inbox-gmail-composio';
import imapInbox from '@business-os/connector-email-inbox-imap';

// Inbox triage agents.
import cleanup from '@business-os/agent-inbox-cleanup';
import categorize from '@business-os/agent-inbox-categorize';
import surface from '@business-os/agent-inbox-surface';

import type { MigrationOwner } from '@business-os/db';

export function buildRegistry(): Registry {
  const registry = new Registry();

  // ---- Connectors ----
  // LLM — operator picks Anthropic or OpenAI per agent in the settings UI.
  registry.registerConnectorProvider(anthropic);
  registry.registerConnectorProvider(openai);

  // email-inbox — all three providers registered; operator binds one per
  // agent (different mailboxes for cleanup vs surface, if you want).
  registry.registerConnectorProvider(outlookInbox);
  registry.registerConnectorProvider(gmailInbox);
  registry.registerConnectorProvider(imapInbox);

  // ---- Agents ----
  registry.registerAgent(cleanup);
  registry.registerAgent(categorize);
  registry.registerAgent(surface);

  return registry;
}

/**
 * Additional migration owners for agents + connectors that ship their own.
 * None of the inbox connectors or agents own tables — they're stateless
 * over the provider — so this list is empty.
 */
export const extraMigrations: MigrationOwner[] = [];

export type { Registry, Scheduler };
export { createConnectorResolver };
