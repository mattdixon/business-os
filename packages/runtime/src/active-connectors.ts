import { eq, and } from 'drizzle-orm';
import type { Db } from '@business-os/db';
import { connectorInstances, settings } from '@business-os/db';
import type { SecretsStore } from '@business-os/core/secrets';
import type {
  ConnectorCapabilityMap,
  ConnectorContext,
  ConnectorCredentials,
} from '@business-os/connector-sdk';
import type { Registry } from './registry.js';
import type { Logger } from 'pino';

/**
 * Resolves the operator-chosen *active* provider for each capability.
 *
 * The DB holds two things per registered provider:
 *  - a row in `connector_instances` (capability + provider_slug + active flag)
 *  - one or more rows in `secrets` (scope = "connector:<cap>:<instance-id>")
 *  - one row in `settings`  (scope = "connector:<cap>:<instance-id>")
 *
 * Per CLAUDE.md: agents ask `ctx.connector('email')` — never name a provider.
 * The active flag is what makes this routing work; only ONE provider per
 * capability can be active at a time.
 */

export interface ConnectorResolver {
  /**
   * Resolve a connector for a capability.
   * - Default: returns the operator-chosen *active* provider for the capability.
   * - With `{ providerSlug }`: returns the named provider regardless of which
   *   is currently marked active. Used when an agent wants to pin its own
   *   provider per-run (e.g. operator configured Anthropic as the default
   *   but a specific agent is wired to OpenAI in its settings).
   */
  resolve<C extends keyof ConnectorCapabilityMap>(
    capability: C,
    opts?: { providerSlug?: string },
  ): Promise<ConnectorCapabilityMap[C]>;
}

export interface ResolverDeps {
  db: Db;
  secrets: SecretsStore;
  registry: Registry;
  logger: Logger;
}

export class NoActiveConnectorError extends Error {
  constructor(capability: string) {
    super(`No active connector configured for capability "${capability}"`);
    this.name = 'NoActiveConnectorError';
  }
}

const CREDENTIAL_KEY = 'credentials';

export function createConnectorResolver(deps: ResolverDeps): ConnectorResolver {
  return {
    async resolve<C extends keyof ConnectorCapabilityMap>(
      capability: C,
      opts?: { providerSlug?: string },
    ): Promise<ConnectorCapabilityMap[C]> {
      const cap = capability as string;
      const where = opts?.providerSlug
        ? and(
            eq(connectorInstances.capability, cap),
            eq(connectorInstances.providerSlug, opts.providerSlug),
          )
        : and(
            eq(connectorInstances.capability, cap),
            eq(connectorInstances.isActive, true),
          );
      const rows = await deps.db
        .select({
          id: connectorInstances.id,
          providerSlug: connectorInstances.providerSlug,
        })
        .from(connectorInstances)
        .where(where)
        .limit(1);
      const row = rows[0];
      if (!row) {
        if (opts?.providerSlug) {
          throw new NoActiveConnectorError(
            `${cap} (no instance for provider "${opts.providerSlug}")`,
          );
        }
        throw new NoActiveConnectorError(cap);
      }

      const provider = deps.registry.getConnectorProvider(capability, row.providerSlug);
      const scope = `connector:${cap}:${row.id}`;

      const credentialsJson = await deps.secrets.get(scope, CREDENTIAL_KEY);
      const credentials: ConnectorCredentials = credentialsJson
        ? (JSON.parse(credentialsJson) as ConnectorCredentials)
        : { kind: 'none' };

      // settings (non-secret) — load by scope; validate against the provider schema.
      const settingsRows = await deps.db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.scope, scope))
        .limit(1);
      const rawSettings = settingsRows[0]?.value ?? {};
      const parsedSettings = provider.manifest.settingsSchema.parse(rawSettings) as unknown;

      const childLogger = deps.logger.child({
        connector: { capability: cap, provider: row.providerSlug, instance_id: row.id },
      });
      const ctx: ConnectorContext<unknown> = {
        credentials,
        settings: parsedSettings,
        logger: {
          info: (o, m) => childLogger.info(o as object, m),
          warn: (o, m) => childLogger.warn(o as object, m),
          error: (o, m) => childLogger.error(o as object, m),
        },
        refreshOAuth: async (newCreds: ConnectorCredentials) => {
          await deps.secrets.put(scope, CREDENTIAL_KEY, JSON.stringify(newCreds));
        },
      };
      return provider.factory(ctx) as ConnectorCapabilityMap[C];
    },
  };
}
