/**
 * @frontrangesystems/business-os-connectors-all
 *
 * Re-exports every framework-shipped connector. Client shells import this
 * one package and call `registry.registerMany(allFrameworkConnectors)` —
 * no per-connector imports needed. Adding a new framework connector becomes
 * "ship the package + add it here," with zero client-side code changes.
 *
 * Whether a connector is *visible to operators* (shows up in the Add Instance
 * dropdown) is controlled by the operator UI's Providers page, not by what's
 * registered. Everything in this file ships to every install; the operator
 * toggles which providers are surfaced.
 */

import anthropic from '@frontrangesystems/business-os-connector-anthropic';
import openai from '@frontrangesystems/business-os-connector-openai';
import emailStub from '@frontrangesystems/business-os-connector-email-stub';
import crmStub, { crmStubMigrations } from '@frontrangesystems/business-os-connector-crm-stub';
import emailGmailComposio from '@frontrangesystems/business-os-connector-email-gmail-composio';
import emailResend from '@frontrangesystems/business-os-connector-resend';
import emailInboxGmailComposio from '@frontrangesystems/business-os-connector-email-inbox-gmail-composio';
import emailInboxOutlookComposio from '@frontrangesystems/business-os-connector-email-inbox-outlook-composio';
import emailInboxImap from '@frontrangesystems/business-os-connector-email-inbox-imap';

import type { ConnectorPackage, ConnectorCapabilityMap } from '@frontrangesystems/business-os-connector-sdk';
import type { MigrationOwner } from '@frontrangesystems/business-os-db';

/**
 * Every framework connector, in registration order. Order doesn't affect
 * runtime behavior; it just controls the default visual order in the
 * Providers UI before the operator picks favorites.
 *
 * Cast to a homogeneous array of `ConnectorPackage<any>` so the registry's
 * `registerMany` accepts the lot. The individual modules retain their
 * narrow capability typing.
 */
export const allFrameworkConnectors: ConnectorPackage<keyof ConnectorCapabilityMap>[] = [
  // LLM
  anthropic as ConnectorPackage<keyof ConnectorCapabilityMap>,
  openai as ConnectorPackage<keyof ConnectorCapabilityMap>,
  // Email (send)
  emailStub as ConnectorPackage<keyof ConnectorCapabilityMap>,
  emailGmailComposio as ConnectorPackage<keyof ConnectorCapabilityMap>,
  emailResend as ConnectorPackage<keyof ConnectorCapabilityMap>,
  // Email (inbox)
  emailInboxGmailComposio as ConnectorPackage<keyof ConnectorCapabilityMap>,
  emailInboxOutlookComposio as ConnectorPackage<keyof ConnectorCapabilityMap>,
  emailInboxImap as ConnectorPackage<keyof ConnectorCapabilityMap>,
  // CRM
  crmStub as ConnectorPackage<keyof ConnectorCapabilityMap>,
];

/**
 * Migration owners for every framework connector that ships SQL. Always
 * applied at boot — running migrations is decoupled from operator-facing
 * enable/disable so disabling a connector doesn't strand schema in a
 * partially-applied state.
 */
export const allFrameworkConnectorMigrations: MigrationOwner[] = [
  crmStubMigrations,
];

// Re-export the named connectors so a shell that needs one specifically
// (test fixtures, custom wiring) can still import by name.
export {
  anthropic,
  openai,
  emailStub,
  crmStub,
  emailGmailComposio,
  emailResend,
  emailInboxGmailComposio,
  emailInboxOutlookComposio,
  emailInboxImap,
};
