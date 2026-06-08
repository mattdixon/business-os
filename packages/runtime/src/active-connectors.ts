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
 * Resolves the connector an agent should use for each capability.
 *
 * Two resolution modes:
 *  - **Agent-scoped (`{ agentSlug }`)** — the framework looks up the agent's
 *    bindings (`agent-bindings:<slug>` in the settings table) and resolves
 *    to the specific connector instance the operator picked for this agent.
 *    Fails loud if no binding exists for a capability the agent declared as
 *    required. This is the path the runner always uses.
 *  - **Default** (no agent context) — falls back to the first connected
 *    instance for the capability. Used by ad-hoc tooling and the existing
 *    tests; not used by agent runs.
 *
 * Per CLAUDE.md: agents call `ctx.connector('email')` — never name a provider.
 * Multiple instances per capability are now allowed (one Gmail account per
 * agent, etc); the binding map is what disambiguates.
 */

export interface ConnectorResolver {
  /**
   * Resolve a connector for a capability.
   * - With `{ agentSlug }`: looks up the agent's binding map and resolves
   *   to the bound instance. Throws if no binding exists for `capability`.
   * - With `{ providerSlug }`: returns the named provider (any instance).
   *   Used by tooling, not agents.
   * - Default: returns the first connected instance for `capability`. Legacy
   *   path for non-agent callers.
   */
  resolve<C extends keyof ConnectorCapabilityMap>(
    capability: C,
    opts?: { providerSlug?: string; agentSlug?: string },
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

export class MissingAgentBindingError extends Error {
  constructor(agentSlug: string, capability: string) {
    super(
      `Agent "${agentSlug}" has no connector binding for capability "${capability}". ` +
        `Open the agent's Settings page and pick a connector instance.`,
    );
    this.name = 'MissingAgentBindingError';
  }
}

const CREDENTIAL_KEY = 'credentials';
const AGENT_BINDINGS_SCOPE = (slug: string): string => `agent-bindings:${slug}`;

async function loadAgentBindings(db: Db, slug: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.scope, AGENT_BINDINGS_SCOPE(slug)))
    .limit(1);
  const v = rows[0]?.value;
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, string>;
  return {};
}

export function createConnectorResolver(deps: ResolverDeps): ConnectorResolver {
  return {
    async resolve<C extends keyof ConnectorCapabilityMap>(
      capability: C,
      opts?: { providerSlug?: string; agentSlug?: string },
    ): Promise<ConnectorCapabilityMap[C]> {
      const cap = capability as string;

      // Agent-scoped path: look up bindings, fail loud on missing.
      let instanceId: string | undefined;
      if (opts?.agentSlug && !opts?.providerSlug) {
        const bindings = await loadAgentBindings(deps.db, opts.agentSlug);
        instanceId = bindings[cap];
        if (!instanceId) {
          throw new MissingAgentBindingError(opts.agentSlug, cap);
        }
      }

      const where = instanceId
        ? eq(connectorInstances.id, instanceId)
        : opts?.providerSlug
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
          capability: connectorInstances.capability,
        })
        .from(connectorInstances)
        .where(where)
        .limit(1);
      const row = rows[0];
      if (!row) {
        if (instanceId) {
          throw new NoActiveConnectorError(
            `${cap} (bound instance ${instanceId} no longer exists — re-bind in agent settings)`,
          );
        }
        if (opts?.providerSlug) {
          throw new NoActiveConnectorError(
            `${cap} (no instance for provider "${opts.providerSlug}")`,
          );
        }
        throw new NoActiveConnectorError(cap);
      }
      // Sanity: bound instance's capability must match requested capability.
      if (instanceId && row.capability !== cap) {
        throw new NoActiveConnectorError(
          `${cap} (bound instance ${instanceId} is for capability "${row.capability}")`,
        );
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
