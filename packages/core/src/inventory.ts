/**
 * Minimal interfaces core needs from the runtime, defined here so core never
 * imports from @business-os/runtime (which would create a dependency cycle —
 * runtime already imports from core).
 *
 * The runtime's Registry and Scheduler satisfy these structurally.
 */

import type { z } from 'zod';

export interface AgentManifestLike<TSettings extends z.ZodTypeAny = z.ZodTypeAny> {
  slug: string;
  version: string;
  displayName: string;
  description: string;
  requiredConnectors: ReadonlyArray<string>;
  settingsSchema: TSettings;
  /** Optional per-run input schema. UI auto-renders a form when present. */
  inputSchema?: z.ZodTypeAny;
  schedule:
    | { kind: 'cron'; expr: string }
    | { kind: 'manual' }
    | { kind: 'event'; topic: string };
}

export interface RegisteredAgentLike {
  manifest: AgentManifestLike;
}

export interface ConnectorManifestLike {
  slug: string;
  capability: string;
  version: string;
  displayName: string;
  authKind: 'oauth2' | 'api-key' | 'none';
  /**
   * Set when the connector uses an external OAuth broker (e.g. Composio).
   * Mirrors @business-os/connector-sdk's ConnectorManifest.externalOAuth.
   */
  externalOAuth?: {
    provider: 'composio';
    toolkit: string;
  };
  settingsSchema: z.ZodTypeAny;
}

/**
 * Structural interface for external OAuth brokers (Composio, Nango, ...).
 * Core depends only on this shape; the client shell wires a concrete
 * implementation (e.g. ComposioSubstrate from @business-os/connector-composio)
 * into startServer's deps.
 *
 * Mirrors @business-os/connector-sdk's ExternalOAuthBroker.
 */
export interface ExternalOAuthBrokerLike {
  findOrCreateManagedAuthConfig(toolkit: string): Promise<{ id: string; toolkit: string }>;
  createConnectionLink(p: {
    userId: string;
    authConfigId: string;
    callbackUrl: string;
  }): Promise<{ connectionRequestId: string; redirectUrl: string }>;
  getActiveConnection(userId: string, toolkit: string): Promise<string | null>;
}

export interface RegisteredConnectorProviderLike {
  manifest: ConnectorManifestLike;
  capability: string;
  /**
   * Optional "test reachability" hook the connector implements. Core's
   * POST /api/connectors/:id/test calls this with the saved credentials +
   * parsed settings. Throwing surfaces as the test error in the UI.
   */
  verify?: (ctx: {
    credentials: unknown;
    settings: unknown;
    logger: { info: (o: object | string, m?: string) => void; warn: (o: object | string, m?: string) => void; error: (o: object | string, m?: string) => void };
  }) => Promise<void>;
}

export interface ModuleManifestLike<TSettings extends z.ZodTypeAny = z.ZodTypeAny> {
  slug: string;
  version: string;
  displayName: string;
  description: string;
  settingsSchema: TSettings;
  migrationsDir?: string;
  defaultAudience?: unknown;
}

export interface ModulePackageLike {
  manifest: ModuleManifestLike;
  registerRoutes?: (app: unknown, ctx: unknown) => void | Promise<void>;
  uiPages?: Array<{ path: string; navLabel?: string }>;
}

/**
 * The framework's view of what's registered. Implemented by
 * @business-os/runtime's Registry.
 */
export interface AgentInventory {
  listAgents(): RegisteredAgentLike[];
  getAgent(slug: string): RegisteredAgentLike;
  listConnectorProviders(capability: string): RegisteredConnectorProviderLike[];
  getConnectorProvider(
    capability: string,
    slug: string,
  ): RegisteredConnectorProviderLike;
  /** Optional — older Registry shapes may not implement it yet. */
  listModules?(): ModulePackageLike[];
  getModule?(slug: string): ModulePackageLike;
}

/** Implemented by @business-os/runtime's Scheduler. */
export interface ManualTriggerer {
  triggerManual(slug: string, input: unknown, triggeredBy: string): Promise<void>;
}
