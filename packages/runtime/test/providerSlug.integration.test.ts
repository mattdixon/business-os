import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { pino } from 'pino';
import { connectorInstances } from '@business-os/db';
import { eq } from 'drizzle-orm';
import { createSecretsStore } from '@business-os/core/secrets';
import { Registry } from '../src/registry.js';
import { createConnectorResolver, NoActiveConnectorError } from '../src/active-connectors.js';
import { freshDb, pgReachable, TEST_DATABASE_URL } from './_db.js';

const reachable = await pgReachable(TEST_DATABASE_URL);
const d = reachable ? describe : describe.skip;

if (!reachable) {
  // eslint-disable-next-line no-console
  console.warn(
    `[providerSlug.integration] Skipping: Postgres unreachable at ${TEST_DATABASE_URL}.`,
  );
}

const fakeLlm = (slug: string) => ({
  manifest: {
    slug,
    capability: 'llm' as const,
    version: '0.0.1',
    displayName: slug,
    authKind: 'api-key' as const,
    settingsSchema: z.object({}),
  },
  capability: 'llm' as const,
  factory: () => ({
    complete: async () => ({
      content: `hello from ${slug}`,
      stopReason: 'end' as const,
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
  }),
});

d('ConnectorResolver providerSlug (real Postgres)', () => {
  let env: Awaited<ReturnType<typeof freshDb>>;
  let registry: Registry;
  let resolver: ReturnType<typeof createConnectorResolver>;
  const logger = pino({ level: 'silent' });

  beforeAll(async () => {
    env = await freshDb();
    registry = new Registry();
    registry.registerConnectorProvider(fakeLlm('anthropic'));
    registry.registerConnectorProvider(fakeLlm('openai'));
    const secrets = createSecretsStore(env.db, new Uint8Array(randomBytes(32)));
    resolver = createConnectorResolver({ db: env.db, secrets, registry, logger });

    // Two registered llm instances: anthropic active, openai inactive.
    await env.db.insert(connectorInstances).values([
      {
        capability: 'llm',
        providerSlug: 'anthropic',
        displayName: 'Anthropic',
        isActive: true,
      },
      {
        capability: 'llm',
        providerSlug: 'openai',
        displayName: 'OpenAI',
        isActive: false,
      },
    ]);
  });

  afterAll(async () => {
    await env.sql.end({ timeout: 1 });
  });

  it('default resolve() returns the operator-active provider', async () => {
    const llm = await resolver.resolve('llm');
    const r = await llm.complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(r.content).toBe('hello from anthropic');
  });

  it('resolve({ providerSlug }) pins a specific provider regardless of active flag', async () => {
    const llm = await resolver.resolve('llm', { providerSlug: 'openai' });
    const r = await llm.complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(r.content).toBe('hello from openai');
  });

  it('resolve({ providerSlug }) throws when no instance is registered for that slug', async () => {
    await expect(
      resolver.resolve('llm', { providerSlug: 'bedrock' }),
    ).rejects.toBeInstanceOf(NoActiveConnectorError);
  });

  it('resolve({ agentSlug }) honors per-agent binding even when another instance is "active"', async () => {
    const { settings } = await import('@business-os/db');
    // anthropic is the globally-active llm in this test setup, but bind
    // leadgen to the openai instance instead.
    const openaiRow = await env.db
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.providerSlug, 'openai'))
      .limit(1);
    await env.db.insert(settings).values({
      scope: 'agent-bindings:leadgen',
      value: { llm: openaiRow[0]!.id },
    });
    const llm = await resolver.resolve('llm', { agentSlug: 'leadgen' });
    const r = await llm.complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(r.content).toBe('hello from openai');
  });

  it('resolve({ agentSlug }) throws MissingAgentBindingError when capability has no binding', async () => {
    const { MissingAgentBindingError } = await import('../src/active-connectors.js');
    await expect(
      resolver.resolve('llm', { agentSlug: 'agent-with-no-bindings' }),
    ).rejects.toBeInstanceOf(MissingAgentBindingError);
  });
});
