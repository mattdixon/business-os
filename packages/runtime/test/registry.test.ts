import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  Registry,
  DuplicateAgentSlugError,
  DuplicateConnectorProviderError,
  UnknownAgentError,
  UnknownConnectorProviderError,
} from '../src/registry.js';

const fakeAgent = (slug: string) => ({
  manifest: {
    slug,
    version: '0.0.1',
    displayName: slug,
    description: 'test',
    requiredConnectors: [] as const,
    settingsSchema: z.object({}),
    schedule: { kind: 'manual' as const },
  },
  run: async () => ({ ok: true, summary: 'noop' }),
});

const fakeProvider = (slug: string, capability: 'email' = 'email') => ({
  manifest: {
    slug,
    capability,
    version: '0.0.1',
    displayName: slug,
    authKind: 'none' as const,
    settingsSchema: z.object({}),
  },
  capability,
  factory: () => ({
    send: async () => ({ messageId: 'fake' }),
  }),
});

describe('Registry', () => {
  it('registers + looks up an agent', () => {
    const r = new Registry();
    r.registerAgent(fakeAgent('a'));
    expect(r.getAgent('a').manifest.slug).toBe('a');
    expect(r.listAgents()).toHaveLength(1);
  });

  it('rejects duplicate agent slugs', () => {
    const r = new Registry();
    r.registerAgent(fakeAgent('a'));
    expect(() => r.registerAgent(fakeAgent('a'))).toThrow(DuplicateAgentSlugError);
  });

  it('throws UnknownAgentError on missing slug', () => {
    const r = new Registry();
    expect(() => r.getAgent('nope')).toThrow(UnknownAgentError);
  });

  it('keeps providers separate per capability', () => {
    const r = new Registry();
    r.registerConnectorProvider(fakeProvider('gmail', 'email'));
    r.registerConnectorProvider(fakeProvider('outlook', 'email'));
    expect(r.listConnectorProviders('email').map((p) => p.manifest.slug)).toEqual([
      'gmail',
      'outlook',
    ]);
    expect(r.listConnectorProviders('crm')).toHaveLength(0);
  });

  it('rejects duplicate (capability, slug) provider pairs', () => {
    const r = new Registry();
    r.registerConnectorProvider(fakeProvider('gmail', 'email'));
    expect(() => r.registerConnectorProvider(fakeProvider('gmail', 'email'))).toThrow(
      DuplicateConnectorProviderError,
    );
  });

  it('throws UnknownConnectorProviderError', () => {
    const r = new Registry();
    expect(() => r.getConnectorProvider('email', 'gmail')).toThrow(
      UnknownConnectorProviderError,
    );
  });

  // Regression: connectors built via defineConnector({ manifest, factory })
  // never set a top-level `capability` field on the wrapper. The registry
  // must read manifest.capability and bucket them correctly anyway, or every
  // listConnectorProviders('llm'|'email'|...) call from the Connectors UI
  // returns empty.
  it('registers providers that only carry capability on the manifest', () => {
    const r = new Registry();
    const minimalProvider = {
      manifest: {
        slug: 'anthropic-like',
        capability: 'llm' as const,
        version: '0.0.1',
        displayName: 'Anthropic-like',
        authKind: 'api-key' as const,
        settingsSchema: z.object({}),
      },
      factory: () =>
        ({
          complete: async () => ({
            content: '',
            stopReason: 'end' as const,
            usage: { inputTokens: 0, outputTokens: 0 },
          }),
        }) as never,
    };
    // Cast through `as never` — TS otherwise wants a top-level `capability`,
    // which the real defineConnector return shape does NOT carry. The whole
    // point of this test is to exercise that runtime path.
    r.registerConnectorProvider(minimalProvider as never);
    expect(r.listConnectorProviders('llm').map((p) => p.manifest.slug)).toEqual([
      'anthropic-like',
    ]);
  });
});
