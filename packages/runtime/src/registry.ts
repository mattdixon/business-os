import type { z } from 'zod';
import type {
  AgentManifest,
  AgentRun,
} from '@business-os/agent-sdk';
import type {
  ConnectorCapabilityMap,
  ConnectorManifest,
  ConnectorContext,
} from '@business-os/connector-sdk';

/**
 * The agent + connector registries.
 *
 * Per CLAUDE.md the client shell's `business-os.config.ts` declares which
 * agents and connectors are wired in. That config is what calls
 * `registry.registerAgent(...)` / `registry.registerConnectorProvider(...)`
 * before the runtime boots.
 *
 * The registry itself has no opinions about scheduling or runtime — it's a
 * typed lookup that the rest of the runtime consults.
 */

export interface RegisteredAgent {
  manifest: AgentManifest<z.ZodTypeAny>;
  run: AgentRun;
}

export interface RegisteredConnectorProvider<
  C extends keyof ConnectorCapabilityMap = keyof ConnectorCapabilityMap,
> {
  manifest: ConnectorManifest<z.ZodTypeAny>;
  capability: C;
  factory: (
    ctx: ConnectorContext<unknown>,
  ) => ConnectorCapabilityMap[C];
}

export class DuplicateAgentSlugError extends Error {
  constructor(slug: string) {
    super(`Agent slug "${slug}" is already registered`);
    this.name = 'DuplicateAgentSlugError';
  }
}
export class DuplicateConnectorProviderError extends Error {
  constructor(capability: string, slug: string) {
    super(`Connector provider "${slug}" for capability "${capability}" is already registered`);
    this.name = 'DuplicateConnectorProviderError';
  }
}
export class UnknownAgentError extends Error {
  constructor(slug: string) {
    super(`No agent registered with slug "${slug}"`);
    this.name = 'UnknownAgentError';
  }
}
export class UnknownConnectorProviderError extends Error {
  constructor(capability: string, slug: string) {
    super(`No connector provider "${slug}" registered for capability "${capability}"`);
    this.name = 'UnknownConnectorProviderError';
  }
}

export class Registry {
  private agents = new Map<string, RegisteredAgent>();
  private providers = new Map<string, Map<string, RegisteredConnectorProvider>>();

  registerAgent(agent: RegisteredAgent): void {
    const slug = agent.manifest.slug;
    if (this.agents.has(slug)) throw new DuplicateAgentSlugError(slug);
    this.agents.set(slug, agent);
  }

  registerConnectorProvider<C extends keyof ConnectorCapabilityMap>(
    provider: RegisteredConnectorProvider<C>,
  ): void {
    const cap = provider.capability as string;
    const slug = provider.manifest.slug;
    let byCap = this.providers.get(cap);
    if (!byCap) {
      byCap = new Map();
      this.providers.set(cap, byCap);
    }
    if (byCap.has(slug)) throw new DuplicateConnectorProviderError(cap, slug);
    byCap.set(slug, provider as RegisteredConnectorProvider);
  }

  getAgent(slug: string): RegisteredAgent {
    const a = this.agents.get(slug);
    if (!a) throw new UnknownAgentError(slug);
    return a;
  }

  listAgents(): RegisteredAgent[] {
    return [...this.agents.values()];
  }

  getConnectorProvider<C extends keyof ConnectorCapabilityMap>(
    capability: C,
    providerSlug: string,
  ): RegisteredConnectorProvider<C> {
    const byCap = this.providers.get(capability as string);
    const p = byCap?.get(providerSlug);
    if (!p) throw new UnknownConnectorProviderError(capability as string, providerSlug);
    return p as RegisteredConnectorProvider<C>;
  }

  listConnectorProviders<C extends keyof ConnectorCapabilityMap>(
    capability: C,
  ): RegisteredConnectorProvider<C>[] {
    const byCap = this.providers.get(capability as string);
    return byCap ? ([...byCap.values()] as RegisteredConnectorProvider<C>[]) : [];
  }
}
