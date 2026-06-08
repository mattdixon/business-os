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
  settingsSchema: z.ZodTypeAny;
}

export interface RegisteredConnectorProviderLike {
  manifest: ConnectorManifestLike;
  capability: string;
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
