import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { buildApp, SESSION_COOKIE } from '../src/app.js';
import { createSecretsStore } from '../src/secrets/index.js';
import { createUser } from '../src/auth/users.js';
import type { AgentInventory, ManualTriggerer } from '../src/inventory.js';
import { freshDb, pgReachable, TEST_DATABASE_URL } from './_db.js';

const reachable = await pgReachable(TEST_DATABASE_URL);
const d = reachable ? describe : describe.skip;

if (!reachable) {
  // eslint-disable-next-line no-console
  console.warn(
    `[admin.integration] Skipping: Postgres unreachable at ${TEST_DATABASE_URL}.`,
  );
}

/**
 * Hand-rolled fake registry that satisfies AgentInventory structurally.
 * Used here so this test doesn't depend on @business-os/runtime (the
 * Registry is itself integration-tested in runtime/test).
 */
function fakeInventory(): AgentInventory {
  const agentManifest = {
    slug: 'leadgen',
    version: '0.1.0',
    displayName: 'Lead Generation',
    description: 'finds prospects',
    requiredConnectors: ['email', 'llm'] as const,
    settingsSchema: z.object({
      icp: z.string().min(1),
      maxPerRun: z.number().int().positive().default(25),
    }),
    schedule: { kind: 'manual' as const },
  };
  const llmProviderManifest = {
    slug: 'anthropic',
    capability: 'llm',
    version: '0.1.0',
    displayName: 'Anthropic',
    authKind: 'api-key' as const,
    settingsSchema: z.object({
      defaultModel: z.string().default('claude-opus-4-7'),
    }),
  };
  const emailProviderManifest = {
    slug: 'gmail',
    capability: 'email',
    version: '0.1.0',
    displayName: 'Gmail',
    authKind: 'oauth2' as const,
    settingsSchema: z.object({}),
  };

  return {
    listAgents: () => [{ manifest: agentManifest }],
    getAgent: (slug: string) => {
      if (slug !== 'leadgen') throw new Error('not found');
      return { manifest: agentManifest };
    },
    listConnectorProviders: (cap: string) => {
      if (cap === 'llm') return [{ manifest: llmProviderManifest, capability: 'llm' }];
      if (cap === 'email') return [{ manifest: emailProviderManifest, capability: 'email' }];
      return [];
    },
    getConnectorProvider: (cap: string, slug: string) => {
      if (cap === 'llm' && slug === 'anthropic')
        return { manifest: llmProviderManifest, capability: 'llm' };
      if (cap === 'email' && slug === 'gmail')
        return { manifest: emailProviderManifest, capability: 'email' };
      throw new Error('not found');
    },
  };
}

d('admin/operator API (real Postgres)', () => {
  let env: Awaited<ReturnType<typeof freshDb>>;
  let app: ReturnType<typeof buildApp>;
  const triggered: Array<{ slug: string; input: unknown; userId: string }> = [];
  const encryptionKey = new Uint8Array(randomBytes(32));
  let cookie = '';

  const trigger: ManualTriggerer = {
    triggerManual: async (slug, input, userId) => {
      triggered.push({ slug, input, userId });
    },
  };

  beforeAll(async () => {
    env = await freshDb();
    const secrets = createSecretsStore(env.db, encryptionKey);
    app = buildApp({
      db: env.db,
      secrets,
      encryptionKey,
      clientSlug: 'test',
      logger: false,
      serveUi: false,
      inventory: fakeInventory(),
      trigger,
    });
    await app.ready();
    await createUser(env.db, {
      email: 'op@example.com',
      password: 'correct-horse-battery-staple',
    });
    // Log in once and reuse the cookie across tests.
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'op@example.com', password: 'correct-horse-battery-staple' },
    });
    const setCookie = login.headers['set-cookie'];
    const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const m = (header ?? '').match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
    cookie = `${SESSION_COOKIE}=${m?.[1]}`;
  });

  afterAll(async () => {
    await app.close();
    await env.sql.end({ timeout: 1 });
  });

  it('rejects unauthenticated /api/agents', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(r.statusCode).toBe(401);
  });

  it('lists registered agents (including a null lastRun before any runs)', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].slug).toBe('leadgen');
    expect(body.agents[0].lastRun).toBeNull();
    expect(body.agents[0].requiredConnectors).toEqual(['email', 'llm']);
  });

  it('returns 404 for unknown agent slug', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/agents/nope',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(404);
  });

  it('round-trips agent settings via PUT then GET (and validates schema)', async () => {
    // Invalid: missing required `icp`
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/agents/leadgen/settings',
      headers: { cookie },
      payload: { value: { maxPerRun: 10 } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('settings_schema_violation');

    const ok = await app.inject({
      method: 'PUT',
      url: '/api/agents/leadgen/settings',
      headers: { cookie },
      payload: { value: { icp: 'concrete contractors $5M+', maxPerRun: 10 } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().settings.icp).toBe('concrete contractors $5M+');

    const get = await app.inject({
      method: 'GET',
      url: '/api/agents/leadgen',
      headers: { cookie },
    });
    expect(get.json().settings.icp).toBe('concrete contractors $5M+');
    expect(get.json().settings.maxPerRun).toBe(10);
  });

  it('POST /api/agents/:slug/run dispatches via trigger and audits', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/agents/leadgen/run',
      headers: { cookie },
      payload: { input: { batch: 1 } },
    });
    expect(r.statusCode).toBe(200);
    expect(triggered.at(-1)?.slug).toBe('leadgen');
    expect(triggered.at(-1)?.input).toEqual({ batch: 1 });
  });

  it('GET /api/connectors returns capabilities + registered providers', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/connectors',
      headers: { cookie },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    const llm = body.capabilities.find((c: { capability: string }) => c.capability === 'llm');
    expect(llm.providers.map((p: { slug: string }) => p.slug)).toContain('anthropic');
    expect(llm.instances).toEqual([]);
  });

  it('connector lifecycle: create → set credentials → activate → cascade delete', async () => {
    // Create
    const create = await app.inject({
      method: 'POST',
      url: '/api/connectors',
      headers: { cookie },
      payload: {
        capability: 'llm',
        providerSlug: 'anthropic',
        displayName: 'Anthropic (CNN)',
      },
    });
    expect(create.statusCode).toBe(200);
    const id = create.json().instance.id;
    expect(create.json().instance.isActive).toBe(false);

    // Set credentials (encrypted at rest)
    const creds = await app.inject({
      method: 'PUT',
      url: `/api/connectors/${id}/credentials`,
      headers: { cookie },
      payload: { credentials: { apiKey: 'sk-ant-test' } },
    });
    expect(creds.statusCode).toBe(200);

    // Activate + set settings
    const update = await app.inject({
      method: 'PATCH',
      url: `/api/connectors/${id}`,
      headers: { cookie },
      payload: {
        isActive: true,
        settings: { defaultModel: 'claude-opus-4-7' },
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().instance.isActive).toBe(true);

    // Verify there's exactly one active LLM instance (the one we just activated).
    const list = await app.inject({
      method: 'GET',
      url: '/api/connectors',
      headers: { cookie },
    });
    const llmCap = list.json().capabilities.find((c: { capability: string }) => c.capability === 'llm');
    const active = llmCap.instances.filter((i: { isActive: boolean }) => i.isActive);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(id);

    // Bad settings rejected
    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/connectors/${id}`,
      headers: { cookie },
      payload: { settings: { defaultModel: 123 } },
    });
    expect(bad.statusCode).toBe(400);

    // Delete cascades settings + secrets
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/connectors/${id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/api/connectors',
      headers: { cookie },
    });
    const llmCapAfter = after.json().capabilities.find((c: { capability: string }) => c.capability === 'llm');
    expect(llmCapAfter.instances.find((i: { id: string }) => i.id === id)).toBeUndefined();
  });

  it('admin endpoints return 503 when inventory is not wired', async () => {
    const secrets = createSecretsStore(env.db, encryptionKey);
    const bare = buildApp({
      db: env.db,
      secrets,
      encryptionKey,
      clientSlug: 'test',
      logger: false,
      serveUi: false,
      // no inventory, no trigger
    });
    await bare.ready();
    try {
      // Need a session for this app too — but we can reuse the user.
      const login = await bare.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'op@example.com', password: 'correct-horse-battery-staple' },
      });
      const setCookie = login.headers['set-cookie'];
      const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      const m = (header ?? '').match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
      const bareCookie = `${SESSION_COOKIE}=${m?.[1]}`;
      const r = await bare.inject({
        method: 'GET',
        url: '/api/agents',
        headers: { cookie: bareCookie },
      });
      expect(r.statusCode).toBe(503);
      expect(r.json().error).toBe('inventory_not_wired');
    } finally {
      await bare.close();
    }
  });
});
