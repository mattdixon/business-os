import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, desc, and } from 'drizzle-orm';
import {
  agentRuns,
  settings as settingsTable,
  connectorInstances,
} from '@business-os/db';
import type { Db } from '@business-os/db';
import { requireUser } from './_require-user.js';
import { zodToFieldSchema } from '../zod-form.js';

/**
 * Admin / operator API.
 *
 * Surface the framework's runtime state through REST so any operator UI
 * (or curl, for now) can:
 *   - list registered agents and their current settings
 *   - update agent settings (validated against the manifest's Zod schema)
 *   - trigger a manual run
 *   - list recent agent_runs
 *   - list registered connector providers per capability
 *   - register a connector instance, mark it active, set its settings,
 *     and store encrypted credentials (via SecretsStore — bytes never
 *     leave that interface)
 *
 * Every endpoint requires an authenticated session. Auth model is
 * intentionally simple right now: any active user is an operator.
 * Roles can be added later without breaking these routes.
 */

const SETTINGS_AGENT_SCOPE = (slug: string): string => `agent:${slug}`;
const SETTINGS_CONNECTOR_SCOPE = (cap: string, id: string): string =>
  `connector:${cap}:${id}`;
const SECRETS_CONNECTOR_SCOPE = SETTINGS_CONNECTOR_SCOPE;
const CREDENTIAL_KEY = 'credentials';

// -----------------------------------------------------------------------------
// Schemas (kept inline; promotable to api-contract once a second consumer needs them)
// -----------------------------------------------------------------------------

const UpdateAgentSettingsRequest = z.object({
  value: z.unknown(),
});

const CreateConnectorInstanceRequest = z.object({
  capability: z.string().min(1),
  providerSlug: z.string().min(1),
  displayName: z.string().min(1),
});

const UpdateConnectorInstanceRequest = z.object({
  displayName: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  settings: z.unknown().optional(),
});

const SetConnectorCredentialsRequest = z.object({
  /**
   * Free-form connector-defined credential payload. Stored encrypted at rest
   * via SecretsStore.
   */
  credentials: z.unknown(),
});

const TriggerAgentRequest = z.object({
  input: z.unknown().optional(),
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function require503<T>(thing: T | undefined, reply: FastifyReply, label: string): thing is T {
  if (!thing) {
    reply
      .code(503)
      .send({ error: `${label}_not_wired`, hint: `Provide deps.${label} in buildApp().` });
    return false;
  }
  return true;
}

async function loadAgentSettings(req: FastifyRequest, slug: string): Promise<unknown> {
  const rows = await req.deps.db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.scope, SETTINGS_AGENT_SCOPE(slug)))
    .limit(1);
  return rows[0]?.value ?? null;
}

async function loadConnectorSettings(
  db: Db,
  capability: string,
  instanceId: string,
): Promise<unknown> {
  const rows = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.scope, SETTINGS_CONNECTOR_SCOPE(capability, instanceId)))
    .limit(1);
  return rows[0]?.value ?? null;
}

// -----------------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------------

export function registerAdminRoutes(app: FastifyInstance): void {
  // ---------- GET /api/agents ----------
  app.get('/api/agents', { preHandler: requireUser }, async (req, reply) => {
    if (!require503(req.deps.inventory, reply, 'inventory')) return;
    const items = await Promise.all(
      req.deps.inventory.listAgents().map(async ({ manifest }) => {
        const settingsValue = await loadAgentSettings(req, manifest.slug);
        const lastRunRows = await req.deps.db
          .select({
            id: agentRuns.id,
            startedAt: agentRuns.startedAt,
            endedAt: agentRuns.endedAt,
            ok: agentRuns.ok,
            summary: agentRuns.summary,
          })
          .from(agentRuns)
          .where(eq(agentRuns.agentSlug, manifest.slug))
          .orderBy(desc(agentRuns.startedAt))
          .limit(1);
        return {
          slug: manifest.slug,
          version: manifest.version,
          displayName: manifest.displayName,
          description: manifest.description,
          requiredConnectors: manifest.requiredConnectors,
          schedule: manifest.schedule,
          settings: settingsValue,
          lastRun: lastRunRows[0] ?? null,
        };
      }),
    );
    return { agents: items };
  });

  // ---------- GET /api/agents/:slug ----------
  app.get('/api/agents/:slug', { preHandler: requireUser }, async (req, reply) => {
    if (!require503(req.deps.inventory, reply, 'inventory')) return;
    const slug = (req.params as { slug: string }).slug;
    let agent;
    try {
      agent = req.deps.inventory.getAgent(slug);
    } catch {
      reply.code(404).send({ error: 'agent_not_found' });
      return;
    }
    const settingsValue = await loadAgentSettings(req, slug);
    return {
      slug: agent.manifest.slug,
      version: agent.manifest.version,
      displayName: agent.manifest.displayName,
      description: agent.manifest.description,
      requiredConnectors: agent.manifest.requiredConnectors,
      schedule: agent.manifest.schedule,
      settings: settingsValue,
    };
  });

  // ---------- PUT /api/agents/:slug/settings ----------
  app.put('/api/agents/:slug/settings', { preHandler: requireUser }, async (req, reply) => {
    if (!require503(req.deps.inventory, reply, 'inventory')) return;
    const slug = (req.params as { slug: string }).slug;
    let agent;
    try {
      agent = req.deps.inventory.getAgent(slug);
    } catch {
      reply.code(404).send({ error: 'agent_not_found' });
      return;
    }
    const body = UpdateAgentSettingsRequest.safeParse(req.body);
    if (!body.success) {
      reply.code(400).send({ error: 'invalid_input' });
      return;
    }
    const parsed = agent.manifest.settingsSchema.safeParse(body.data.value);
    if (!parsed.success) {
      reply.code(400).send({
        error: 'settings_schema_violation',
        issues: parsed.error.issues,
      });
      return;
    }
    await req.deps.db
      .insert(settingsTable)
      .values({
        scope: SETTINGS_AGENT_SCOPE(slug),
        value: parsed.data,
        updatedBy: req.user!.id,
      })
      .onConflictDoUpdate({
        target: settingsTable.scope,
        set: {
          value: parsed.data,
          updatedAt: new Date(),
          updatedBy: req.user!.id,
        },
      });
    await req.audit('admin.agent.settings.update', { slug });
    return { ok: true as const, settings: parsed.data };
  });

  // ---------- POST /api/agents/:slug/run ----------
  app.post('/api/agents/:slug/run', { preHandler: requireUser }, async (req, reply) => {
    if (!require503(req.deps.inventory, reply, 'inventory')) return;
    if (!require503(req.deps.trigger, reply, 'trigger')) return;
    const slug = (req.params as { slug: string }).slug;
    try {
      req.deps.inventory.getAgent(slug);
    } catch {
      reply.code(404).send({ error: 'agent_not_found' });
      return;
    }
    const body = TriggerAgentRequest.safeParse(req.body ?? {});
    if (!body.success) {
      reply.code(400).send({ error: 'invalid_input' });
      return;
    }
    await req.deps.trigger.triggerManual(slug, body.data.input, req.user!.id);
    await req.audit('admin.agent.run.manual', { slug });
    return { ok: true as const };
  });

  // ---------- GET /api/agents/:slug/runs ----------
  app.get('/api/agents/:slug/runs', { preHandler: requireUser }, async (req) => {
    const slug = (req.params as { slug: string }).slug;
    const limit = Math.min(
      Number((req.query as { limit?: string }).limit ?? 50),
      200,
    );
    const rows = await req.deps.db
      .select({
        id: agentRuns.id,
        startedAt: agentRuns.startedAt,
        endedAt: agentRuns.endedAt,
        ok: agentRuns.ok,
        summary: agentRuns.summary,
        trigger: agentRuns.trigger,
        triggeredBy: agentRuns.triggeredBy,
      })
      .from(agentRuns)
      .where(eq(agentRuns.agentSlug, slug))
      .orderBy(desc(agentRuns.startedAt))
      .limit(limit);
    return { runs: rows };
  });

  // ---------- GET /api/connectors ----------
  app.get('/api/connectors', { preHandler: requireUser }, async (req, reply) => {
    if (!require503(req.deps.inventory, reply, 'inventory')) return;
    // Build the capability → providers map from the registry, then attach the
    // operator-configured instances per capability.
    const caps = new Set<string>();
    // Walk known capabilities — the registry doesn't expose `listCapabilities`,
    // so we drain the type-registry by probing each known key. Today: email,
    // crm, llm, file-storage. New capabilities added to ConnectorCapabilityMap
    // need adding here too.
    for (const cap of ['email', 'crm', 'llm', 'file-storage']) caps.add(cap);

    const instances = await req.deps.db
      .select()
      .from(connectorInstances);

    const result = await Promise.all(
      [...caps].map(async (capability) => {
        const providers = req.deps.inventory!.listConnectorProviders(capability).map(
          (p) => ({
            slug: p.manifest.slug,
            displayName: p.manifest.displayName,
            authKind: p.manifest.authKind,
            version: p.manifest.version,
            settingsSchema: zodToFieldSchema(p.manifest.settingsSchema),
          }),
        );
        const capInstances = await Promise.all(
          instances
            .filter((i) => i.capability === capability)
            .map(async (i) => {
              const settingsValue = await loadConnectorSettings(req.deps.db, capability, i.id);
              return {
                id: i.id,
                providerSlug: i.providerSlug,
                displayName: i.displayName,
                isActive: i.isActive,
                createdAt: i.createdAt,
                settings: settingsValue,
              };
            }),
        );
        return { capability, providers, instances: capInstances };
      }),
    );
    return { capabilities: result };
  });

  // ---------- POST /api/connectors ----------
  app.post('/api/connectors', { preHandler: requireUser }, async (req, reply) => {
    if (!require503(req.deps.inventory, reply, 'inventory')) return;
    const body = CreateConnectorInstanceRequest.safeParse(req.body);
    if (!body.success) {
      reply.code(400).send({ error: 'invalid_input' });
      return;
    }
    try {
      req.deps.inventory.getConnectorProvider(body.data.capability, body.data.providerSlug);
    } catch {
      reply.code(400).send({ error: 'unknown_provider' });
      return;
    }
    const rows = await req.deps.db
      .insert(connectorInstances)
      .values({
        capability: body.data.capability,
        providerSlug: body.data.providerSlug,
        displayName: body.data.displayName,
        isActive: false,
      })
      .returning();
    await req.audit('admin.connector.create', {
      capability: body.data.capability,
      providerSlug: body.data.providerSlug,
    });
    return { instance: rows[0] };
  });

  // ---------- PATCH /api/connectors/:id ----------
  app.patch('/api/connectors/:id', { preHandler: requireUser }, async (req, reply) => {
    if (!require503(req.deps.inventory, reply, 'inventory')) return;
    const id = (req.params as { id: string }).id;
    const body = UpdateConnectorInstanceRequest.safeParse(req.body);
    if (!body.success) {
      reply.code(400).send({ error: 'invalid_input' });
      return;
    }

    const existingRows = await req.deps.db
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, id))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) {
      reply.code(404).send({ error: 'connector_instance_not_found' });
      return;
    }

    // Validate settings against the provider's manifest if provided.
    if (body.data.settings !== undefined) {
      let provider;
      try {
        provider = req.deps.inventory.getConnectorProvider(
          existing.capability,
          existing.providerSlug,
        );
      } catch {
        reply.code(409).send({ error: 'provider_not_registered_anymore' });
        return;
      }
      const parsed = provider.manifest.settingsSchema.safeParse(body.data.settings);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'settings_schema_violation',
          issues: parsed.error.issues,
        });
        return;
      }
      const scope = SETTINGS_CONNECTOR_SCOPE(existing.capability, existing.id);
      await req.deps.db
        .insert(settingsTable)
        .values({ scope, value: parsed.data, updatedBy: req.user!.id })
        .onConflictDoUpdate({
          target: settingsTable.scope,
          set: {
            value: parsed.data,
            updatedAt: new Date(),
            updatedBy: req.user!.id,
          },
        });
    }

    // If activating, deactivate all other instances for this capability first.
    if (body.data.isActive === true) {
      await req.deps.db
        .update(connectorInstances)
        .set({ isActive: false })
        .where(
          and(
            eq(connectorInstances.capability, existing.capability),
            eq(connectorInstances.isActive, true),
          ),
        );
    }

    const updates: Partial<typeof connectorInstances.$inferInsert> = {};
    if (body.data.displayName !== undefined) updates.displayName = body.data.displayName;
    if (body.data.isActive !== undefined) updates.isActive = body.data.isActive;
    if (Object.keys(updates).length > 0) {
      await req.deps.db
        .update(connectorInstances)
        .set(updates)
        .where(eq(connectorInstances.id, id));
    }
    await req.audit('admin.connector.update', { id, ...body.data });

    const after = await req.deps.db
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, id))
      .limit(1);
    return { instance: after[0] };
  });

  // ---------- PUT /api/connectors/:id/credentials ----------
  app.put('/api/connectors/:id/credentials', { preHandler: requireUser }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = SetConnectorCredentialsRequest.safeParse(req.body);
    if (!body.success) {
      reply.code(400).send({ error: 'invalid_input' });
      return;
    }
    const existing = await req.deps.db
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, id))
      .limit(1);
    if (!existing[0]) {
      reply.code(404).send({ error: 'connector_instance_not_found' });
      return;
    }
    const scope = SECRETS_CONNECTOR_SCOPE(existing[0].capability, id);
    await req.deps.secrets.put(
      scope,
      CREDENTIAL_KEY,
      JSON.stringify(body.data.credentials),
    );
    await req.audit('admin.connector.credentials.update', { id });
    return { ok: true as const };
  });

  // ---------- DELETE /api/connectors/:id ----------
  app.delete('/api/connectors/:id', { preHandler: requireUser }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const existing = await req.deps.db
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, id))
      .limit(1);
    if (!existing[0]) {
      reply.code(404).send({ error: 'connector_instance_not_found' });
      return;
    }
    // Cascade: remove settings + secrets for this instance scope.
    const scope = SECRETS_CONNECTOR_SCOPE(existing[0].capability, id);
    await req.deps.db.delete(settingsTable).where(eq(settingsTable.scope, scope));
    const secretKeys = await req.deps.secrets.listScope(scope);
    for (const k of secretKeys) await req.deps.secrets.delete(scope, k);
    await req.deps.db.delete(connectorInstances).where(eq(connectorInstances.id, id));
    await req.audit('admin.connector.delete', { id });
    return { ok: true as const };
  });
}
