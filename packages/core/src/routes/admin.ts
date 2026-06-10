import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, desc, and, gte, lt, type SQL } from 'drizzle-orm';
import {
  agentRuns,
  auditLog,
  settings as settingsTable,
  connectorInstances,
  users,
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
const SETTINGS_AGENT_BINDINGS_SCOPE = (slug: string): string => `agent-bindings:${slug}`;
const SETTINGS_CONNECTOR_SCOPE = (cap: string, id: string): string =>
  `connector:${cap}:${id}`;
const SECRETS_CONNECTOR_SCOPE = SETTINGS_CONNECTOR_SCOPE;
const CREDENTIAL_KEY = 'credentials';
/**
 * Per-install enable/disable flag for a (capability, providerSlug) pair.
 * Persisted in the `settings` table. Disabled providers stay registered in
 * memory (the runtime always knows about them) but the operator UI hides
 * them from the Add Instance dropdown until re-enabled.
 *
 * Default when no row exists: enabled.
 */
const PROVIDER_ENABLED_SCOPE = (cap: string, slug: string): string =>
  `provider:${cap}:${slug}`;

async function isProviderEnabled(db: Db, cap: string, slug: string): Promise<boolean> {
  const rows = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.scope, PROVIDER_ENABLED_SCOPE(cap, slug)))
    .limit(1);
  const v = rows[0]?.value as { enabled?: boolean } | undefined;
  return v?.enabled !== false; // missing row OR { enabled: true } -> enabled
}

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
  /**
   * Optional one-shot setup. When provided, the framework runs the
   * provider's verify() against this credential payload BEFORE persisting
   * the instance. If verify fails, nothing is written and the operator
   * sees the provider's error. If it succeeds, the instance is created,
   * the credentials saved, settings applied (if any), and isActive set
   * to true — one round-trip from "Add" to "Connected".
   */
  credentials: z.record(z.unknown()).optional(),
  settings: z.unknown().optional(),
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

/**
 * Per-agent connector bindings: which connector instance to use for each
 * capability the agent requires.
 *
 *   { "email": "ae4...uuid", "llm": "be3...uuid" }
 *
 * Validated against the agent's requiredConnectors + existing instances at
 * write time. Missing keys are NOT auto-filled — agents fail loud at run
 * time if a required capability has no binding (deliberate choice; silent
 * fallback to "first connected" hides operator mistakes).
 */
const SetAgentBindingsRequest = z.object({
  bindings: z.record(z.string().uuid()),
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Deterministic Composio "entity" id for a connector instance. Used in both
 * link initiation and active-connection lookup so we don't have to persist
 * extra state between connect and finalize.
 */
function composioUserId(instanceId: string): string {
  return `bos-${instanceId}`;
}

/**
 * Public URL the broker should redirect the operator's browser back to after
 * consent. Composio's hosted callback page will close itself; the UI then
 * polls finalize-connect. For now we redirect back to the settings page —
 * the actual capture happens server-side via getActiveConnection.
 */
function buildCallbackUrl(req: FastifyRequest, _provider: string): string {
  const configured = req.deps.publicUrl;
  if (configured) return `${configured.replace(/\/$/, '')}/connectors`;
  const host = (req.headers['x-forwarded-host'] ?? req.headers.host) as string | undefined;
  const proto = ((req.headers['x-forwarded-proto'] as string) ?? 'http').split(',')[0];
  if (!host) return `http://localhost/connectors`;
  return `${proto}://${host}/connectors`;
}

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

async function loadAgentBindings(
  db: Db,
  slug: string,
): Promise<Record<string, string>> {
  const rows = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.scope, SETTINGS_AGENT_BINDINGS_SCOPE(slug)))
    .limit(1);
  const v = rows[0]?.value;
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, string>;
  return {};
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

/**
 * Run the connector's verify() hook against a *proposed* credentials object —
 * without persisting. Used by POST /api/connectors and PUT /credentials so
 * the operator gets a real test before anything is saved.
 *
 * Returns ok=true when verify is missing (Composio paths) or succeeds, ok=
 * false with the provider's error message on failure.
 */
async function runVerify(args: {
  provider: import('../inventory.js').RegisteredConnectorProviderLike;
  proposedCredentials: Record<string, unknown>;
  proposedSettings?: unknown;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const creds: Record<string, unknown> = { ...args.proposedCredentials };
  if (typeof creds.kind !== 'string') creds.kind = args.provider.manifest.authKind;
  // Always validate custom credentials against credentialsSchema, even when
  // the connector has no verify() hook — a typo'd field name should fail at
  // save time, not at first agent run.
  if (creds.kind === 'custom' && args.provider.manifest.credentialsSchema) {
    const parsed = args.provider.manifest.credentialsSchema.safeParse(creds.values ?? {});
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      };
    }
    creds.values = parsed.data;
  }
  // Settings always validated against the connector's schema. A connector
  // with no verify() hook still benefits from schema-checked settings.
  let settings: unknown;
  try {
    settings = args.provider.manifest.settingsSchema.parse(args.proposedSettings ?? {});
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'invalid settings' };
  }
  if (!args.provider.verify) return { ok: true };
  try {
    await args.provider.verify({
      credentials: creds,
      settings,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
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
          /**
           * Surface the input schema (when present) so the Agents list can
           * decide whether the Run-from-list button fires immediately ({} input)
           * or opens an input modal. Null when the agent doesn't declare one.
           */
          inputSchema: manifest.inputSchema
            ? zodToFieldSchema(manifest.inputSchema)
            : null,
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
    const bindings = await loadAgentBindings(req.deps.db, slug);
    const lastRunRows = await req.deps.db
      .select({
        id: agentRuns.id,
        startedAt: agentRuns.startedAt,
        endedAt: agentRuns.endedAt,
        ok: agentRuns.ok,
        summary: agentRuns.summary,
      })
      .from(agentRuns)
      .where(eq(agentRuns.agentSlug, slug))
      .orderBy(desc(agentRuns.startedAt))
      .limit(1);
    return {
      slug: agent.manifest.slug,
      version: agent.manifest.version,
      displayName: agent.manifest.displayName,
      description: agent.manifest.description,
      requiredConnectors: agent.manifest.requiredConnectors,
      schedule: agent.manifest.schedule,
      settings: settingsValue,
      connectorBindings: bindings,
      settingsSchema: zodToFieldSchema(agent.manifest.settingsSchema),
      inputSchema: agent.manifest.inputSchema
        ? zodToFieldSchema(agent.manifest.inputSchema)
        : null,
      lastRun: lastRunRows[0] ?? null,
    };
  });

  // ---------- PUT /api/agents/:slug/bindings ----------
  app.put('/api/agents/:slug/bindings', { preHandler: requireUser }, async (req, reply) => {
    if (!require503(req.deps.inventory, reply, 'inventory')) return;
    const slug = (req.params as { slug: string }).slug;
    let agent;
    try {
      agent = req.deps.inventory.getAgent(slug);
    } catch {
      reply.code(404).send({ error: 'agent_not_found' });
      return;
    }
    const body = SetAgentBindingsRequest.safeParse(req.body);
    if (!body.success) {
      reply.code(400).send({ error: 'invalid_input' });
      return;
    }

    // Reject capabilities the agent doesn't actually need — keeps bindings
    // tight to the manifest and prevents accidental misbindings.
    const required = new Set(agent.manifest.requiredConnectors);
    for (const cap of Object.keys(body.data.bindings)) {
      if (!required.has(cap)) {
        reply.code(400).send({
          error: 'capability_not_required_by_agent',
          capability: cap,
        });
        return;
      }
    }

    // Verify every referenced instance exists and matches the declared
    // capability. Avoids silently binding to a deleted or mismatched instance.
    for (const [cap, instanceId] of Object.entries(body.data.bindings)) {
      const rows = await req.deps.db
        .select({ id: connectorInstances.id, capability: connectorInstances.capability })
        .from(connectorInstances)
        .where(eq(connectorInstances.id, instanceId))
        .limit(1);
      const inst = rows[0];
      if (!inst) {
        reply.code(400).send({
          error: 'connector_instance_not_found',
          capability: cap,
          instanceId,
        });
        return;
      }
      if (inst.capability !== cap) {
        reply.code(400).send({
          error: 'instance_capability_mismatch',
          capability: cap,
          instanceCapability: inst.capability,
        });
        return;
      }
    }

    await req.deps.db
      .insert(settingsTable)
      .values({
        scope: SETTINGS_AGENT_BINDINGS_SCOPE(slug),
        value: body.data.bindings,
        updatedBy: req.user!.id,
      })
      .onConflictDoUpdate({
        target: settingsTable.scope,
        set: {
          value: body.data.bindings,
          updatedAt: new Date(),
          updatedBy: req.user!.id,
        },
      });
    await req.audit('admin.agent.bindings.update', { slug, bindings: body.data.bindings });
    return { ok: true as const, bindings: body.data.bindings };
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
    const q = req.query as { before?: string };
    const filters: SQL[] = [eq(agentRuns.agentSlug, slug)];
    if (q.before) {
      const t = new Date(q.before);
      if (!Number.isNaN(t.getTime())) filters.push(lt(agentRuns.startedAt, t));
    }
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
      .where(and(...filters))
      .orderBy(desc(agentRuns.startedAt))
      .limit(limit);
    const nextBefore =
      rows.length === limit && rows[rows.length - 1]
        ? rows[rows.length - 1]!.startedAt.toISOString()
        : null;
    return { runs: rows, nextBefore };
  });

  // ---------- GET /api/runs/:id ----------
  // Single run + correlated audit log. The runtime sets requestId=runId when
  // building the AuditContext, so the audit_log.request_id column is the join
  // key.
  app.get('/api/runs/:id', { preHandler: requireUser }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const rows = await req.deps.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, id))
      .limit(1);
    const run = rows[0];
    if (!run) {
      reply.code(404).send({ error: 'run_not_found' });
      return;
    }
    const audits = await req.deps.db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        action: auditLog.action,
        userId: auditLog.userId,
        agentSlug: auditLog.agentSlug,
        meta: auditLog.meta,
      })
      .from(auditLog)
      .where(eq(auditLog.requestId, id))
      .orderBy(auditLog.at);
    return { run, audits };
  });

  // ---------- GET /api/connectors ----------
  app.get('/api/connectors', { preHandler: requireUser }, async (req, reply) => {
    if (!require503(req.deps.inventory, reply, 'inventory')) return;
    // Tell the browser never to cache this — connector state changes
    // mid-session (Save & test, Disconnect, Update key) and operators
    // were seeing stale "not connected" after a fresh add until they
    // hard-refreshed.
    reply.header('cache-control', 'no-store');
    // Build the capability → providers map from the registry, then attach the
    // operator-configured instances per capability.
    const caps = new Set<string>();
    // Walk known capabilities — the registry doesn't expose `listCapabilities`,
    // so we drain the type-registry by probing each known key. New capabilities
    // added to ConnectorCapabilityMap need adding here too.
    for (const cap of ['email', 'email-inbox', 'crm', 'llm', 'file-storage']) caps.add(cap);

    const instances = await req.deps.db
      .select()
      .from(connectorInstances)
      .orderBy(desc(connectorInstances.createdAt));

    const result = await Promise.all(
      [...caps].map(async (capability) => {
        const allProviders = req.deps.inventory!.listConnectorProviders(capability);
        // Filter by operator's enable/disable choice. Disabled providers are
        // still registered (so existing instances keep working) but hidden
        // from the Add Instance dropdown.
        const providers = await Promise.all(
          allProviders.map(async (p) => {
            const enabled = await isProviderEnabled(req.deps.db, capability, p.manifest.slug);
            return {
              slug: p.manifest.slug,
              displayName: p.manifest.displayName,
              authKind: p.manifest.authKind,
              externalOAuth: p.manifest.externalOAuth,
              version: p.manifest.version,
              settingsSchema: zodToFieldSchema(p.manifest.settingsSchema),
              ...(p.manifest.credentialsSchema
                ? { credentialsSchema: zodToFieldSchema(p.manifest.credentialsSchema) }
                : {}),
              enabled,
            };
          }),
        ).then((arr) => arr.filter((p) => p.enabled));
        const capInstances = await Promise.all(
          instances
            .filter((i) => i.capability === capability)
            .map(async (i) => {
              const settingsValue = await loadConnectorSettings(req.deps.db, capability, i.id);
              const credsScope = SECRETS_CONNECTOR_SCOPE(capability, i.id);
              const credBytes = await req.deps.secrets.get(credsScope, CREDENTIAL_KEY);
              return {
                id: i.id,
                providerSlug: i.providerSlug,
                displayName: i.displayName,
                isActive: i.isActive,
                createdAt: i.createdAt,
                settings: settingsValue,
                /**
                 * True iff the operator has saved credentials. The UI uses
                 * this to know which action to surface — "Set key" vs
                 * "Test connection" vs "Update key".
                 */
                hasCredentials: !!credBytes,
              };
            }),
        );
        return { capability, providers, instances: capInstances };
      }),
    );
    return { capabilities: result };
  });

  // ---------- POST /api/connectors ----------
  // One-shot: validate provider exists → if credentials provided, run
  // verify() FIRST (no persisting on failure) → insert instance →
  // save creds + settings → flip isActive=true. Anything that fails
  // partway leaves the operator with no half-broken row to clean up.
  app.post('/api/connectors', { preHandler: requireUser }, async (req, reply) => {
    if (!require503(req.deps.inventory, reply, 'inventory')) return;
    const body = CreateConnectorInstanceRequest.safeParse(req.body);
    if (!body.success) {
      reply.code(400).send({ error: 'invalid_input' });
      return;
    }
    let provider;
    try {
      provider = req.deps.inventory.getConnectorProvider(
        body.data.capability,
        body.data.providerSlug,
      );
    } catch {
      reply.code(400).send({ error: 'unknown_provider' });
      return;
    }

    // If creds supplied, test them BEFORE inserting the row so a failed
    // setup doesn't leave a stub instance behind.
    if (body.data.credentials) {
      const verifyResult = await runVerify({
        provider,
        proposedCredentials: body.data.credentials as Record<string, unknown>,
        proposedSettings: body.data.settings,
      });
      if (!verifyResult.ok) {
        await req.audit('admin.connector.create.verify_failed', {
          capability: body.data.capability,
          providerSlug: body.data.providerSlug,
          error: verifyResult.error,
        });
        return reply.code(400).send({ error: 'verify_failed', message: verifyResult.error });
      }
    }

    const rows = await req.deps.db
      .insert(connectorInstances)
      .values({
        capability: body.data.capability,
        providerSlug: body.data.providerSlug,
        displayName: body.data.displayName,
        isActive: !!body.data.credentials, // active iff creds were tested+saved here
      })
      .returning();
    const instance = rows[0]!;

    if (body.data.credentials) {
      const creds: Record<string, unknown> = { ...(body.data.credentials as Record<string, unknown>) };
      if (typeof creds.kind !== 'string') creds.kind = provider.manifest.authKind;
      await req.deps.secrets.put(
        SECRETS_CONNECTOR_SCOPE(body.data.capability, instance.id),
        CREDENTIAL_KEY,
        JSON.stringify(creds),
      );
    }
    if (body.data.settings !== undefined) {
      await req.deps.db
        .insert(settingsTable)
        .values({
          scope: SETTINGS_CONNECTOR_SCOPE(body.data.capability, instance.id),
          value: body.data.settings,
        })
        .onConflictDoUpdate({
          target: settingsTable.scope,
          set: { value: body.data.settings, updatedAt: new Date() },
        });
    }

    await req.audit('admin.connector.create', {
      capability: body.data.capability,
      providerSlug: body.data.providerSlug,
      activated: !!body.data.credentials,
    });
    return { instance };
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

    // NOTE: previously this branch deactivated all other instances of the
    // same capability when activating one (one-active-per-capability model).
    // That restriction was removed when per-agent connector bindings landed:
    // multiple Gmail / Outlook / IMAP instances can now coexist, all marked
    // active, and each agent picks which one it uses via its bindings.
    // `isActive` semantically now means "this instance is connected and
    // available for an agent to bind to"; the name is left as-is to avoid
    // a wider rename. See agent-bindings flow in this same file.

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
  // Always tests new credentials against the provider's verify() hook
  // BEFORE persisting. On test failure, nothing is written — the existing
  // (working) credentials stay in place. On success, the new creds replace
  // the old and the instance stays active.
  app.put('/api/connectors/:id/credentials', { preHandler: requireUser }, async (req, reply) => {
    if (!require503(req.deps.inventory, reply, 'inventory')) return;
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
    const inst = existing[0];
    const provider = req.deps.inventory.getConnectorProvider(inst.capability, inst.providerSlug);

    const verifyResult = await runVerify({
      provider,
      proposedCredentials: body.data.credentials as Record<string, unknown>,
      proposedSettings: await loadConnectorSettings(req.deps.db, inst.capability, id),
    });
    if (!verifyResult.ok) {
      await req.audit('admin.connector.credentials.verify_failed', { id, error: verifyResult.error });
      return reply.code(400).send({ error: 'verify_failed', message: verifyResult.error });
    }

    const scope = SECRETS_CONNECTOR_SCOPE(inst.capability, id);
    const creds: Record<string, unknown> = { ...(body.data.credentials as Record<string, unknown>) };
    if (typeof creds.kind !== 'string') creds.kind = provider.manifest.authKind;
    await req.deps.secrets.put(scope, CREDENTIAL_KEY, JSON.stringify(creds));
    // Update with new key should leave the instance active.
    await req.deps.db
      .update(connectorInstances)
      .set({ isActive: true })
      .where(eq(connectorInstances.id, id));
    await req.audit('admin.connector.credentials.update', { id });
    return { ok: true as const };
  });

  // ---------- POST /api/connectors/:id/connect ----------
  //
  // Initiates an external-OAuth flow (Composio-driven for now). Returns a
  // redirect URL the operator's browser visits to grant access. After the
  // operator returns, the UI calls finalize-connect (below) to persist the
  // resulting credential.
  //
  // The composio user_id is deterministic (`bos-<instanceId>`) — no
  // intermediate state to store between connect and finalize.
  app.post('/api/connectors/:id/connect', { preHandler: requireUser }, async (req, reply) => {
    if (!require503(req.deps.inventory, reply, 'inventory')) return;
    const id = (req.params as { id: string }).id;

    const rows = await req.deps.db
      .select()
      .from(connectorInstances)
      .where(eq(connectorInstances.id, id))
      .limit(1);
    const instance = rows[0];
    if (!instance) {
      reply.code(404).send({ error: 'connector_instance_not_found' });
      return;
    }

    let provider;
    try {
      provider = req.deps.inventory.getConnectorProvider(
        instance.capability,
        instance.providerSlug,
      );
    } catch {
      reply.code(409).send({ error: 'provider_not_registered_anymore' });
      return;
    }
    const ext = provider.manifest.externalOAuth;
    if (!ext) {
      reply.code(400).send({ error: 'connector_does_not_use_external_oauth' });
      return;
    }
    const broker = req.deps.externalOAuthBrokers?.[ext.provider];
    if (!broker) {
      reply.code(503).send({
        error: 'external_oauth_broker_not_wired',
        hint: `Pass externalOAuthBrokers.${ext.provider} to startServer().`,
      });
      return;
    }

    const callbackUrl = buildCallbackUrl(req, ext.provider);
    const authConfig = await broker.findOrCreateManagedAuthConfig(ext.toolkit);
    const link = await broker.createConnectionLink({
      userId: composioUserId(instance.id),
      authConfigId: authConfig.id,
      callbackUrl,
    });
    await req.audit('admin.connector.connect.initiate', {
      id,
      provider: ext.provider,
      toolkit: ext.toolkit,
    });
    return { redirectUrl: link.redirectUrl };
  });

  // ---------- POST /api/connectors/:id/finalize-connect ----------
  //
  // Polled by the UI after the operator returns from the consent screen.
  // Asks the broker whether the connection is now ACTIVE. If yes, persists
  // the credential (broker API key + per-instance user_id + connected
  // account id) and marks the instance active. If no, returns { pending: true }.
  app.post(
    '/api/connectors/:id/finalize-connect',
    { preHandler: requireUser },
    async (req, reply) => {
      if (!require503(req.deps.inventory, reply, 'inventory')) return;
      const id = (req.params as { id: string }).id;

      const rows = await req.deps.db
        .select()
        .from(connectorInstances)
        .where(eq(connectorInstances.id, id))
        .limit(1);
      const instance = rows[0];
      if (!instance) {
        reply.code(404).send({ error: 'connector_instance_not_found' });
        return;
      }

      let provider;
      try {
        provider = req.deps.inventory.getConnectorProvider(
          instance.capability,
          instance.providerSlug,
        );
      } catch {
        reply.code(409).send({ error: 'provider_not_registered_anymore' });
        return;
      }
      const ext = provider.manifest.externalOAuth;
      if (!ext) {
        reply.code(400).send({ error: 'connector_does_not_use_external_oauth' });
        return;
      }
      const broker = req.deps.externalOAuthBrokers?.[ext.provider];
      if (!broker) {
        reply.code(503).send({ error: 'external_oauth_broker_not_wired' });
        return;
      }

      const userId = composioUserId(instance.id);
      const connectedAccountId = await broker.getActiveConnection(userId, ext.toolkit);
      if (!connectedAccountId) {
        return { pending: true as const };
      }

      // Persist credentials in the shape Composio-backed connectors expect:
      // kind=api-key, key=COMPOSIO_API_KEY, extra=per-instance handles.
      // We snapshot the broker API key from env into the encrypted store so
      // the runtime can materialize the connector without a separate env
      // lookup. Rotating COMPOSIO_API_KEY requires re-finalizing affected
      // instances — acceptable for the rare key-rotation case.
      const brokerApiKey = process.env[`${ext.provider.toUpperCase()}_API_KEY`];
      if (!brokerApiKey) {
        reply.code(500).send({
          error: 'broker_api_key_missing_in_env',
          hint: `${ext.provider.toUpperCase()}_API_KEY must be set in the server's environment.`,
        });
        return;
      }
      const credentialPayload = {
        kind: 'api-key' as const,
        key: brokerApiKey,
        extra: { userId, connectedAccountId },
      };
      const scope = SECRETS_CONNECTOR_SCOPE(instance.capability, id);
      await req.deps.secrets.put(scope, CREDENTIAL_KEY, JSON.stringify(credentialPayload));

      // Mark this instance active. We no longer deactivate siblings — multiple
      // instances per capability can coexist, agents bind to specific ones.
      await req.deps.db
        .update(connectorInstances)
        .set({ isActive: true })
        .where(eq(connectorInstances.id, id));

      await req.audit('admin.connector.connect.finalize', {
        id,
        provider: ext.provider,
        toolkit: ext.toolkit,
      });
      return { ok: true as const, connectedAccountId };
    },
  );

  // ---------- POST /api/connectors/:id/test ----------
  //
  // Calls the connector package's optional `verify(ctx)` hook with the saved
  // credentials + settings. Used by the UI's "Test connection" button.
  // verify() implementations hit the cheapest auth-required endpoint the
  // provider exposes (Anthropic + OpenAI list models; Composio-backed
  // connectors get this for free via the Connect flow). NO billable tokens.
  //
  // On success, returns { ok: true } and the UI flips the instance to active.
  // On failure, returns { ok: false, error: <message> } — UI shows it inline.
  app.post('/api/connectors/:id/test', { preHandler: requireUser }, async (req, reply) => {
    if (!require503(req.deps.inventory, reply, 'inventory')) return;
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
    const inst = existing[0];

    const provider = req.deps.inventory.getConnectorProvider(
      inst.capability,
      inst.providerSlug,
    );
    if (!provider.verify) {
      // No verify hook — nothing to test. Treat as success so Composio-backed
      // connectors don't get stuck behind a missing button.
      return { ok: true as const, message: 'no test available for this connector' };
    }

    // Pull credentials + parsed settings into the ctx the connector expects.
    const scope = SECRETS_CONNECTOR_SCOPE(inst.capability, id);
    const rawCreds = await req.deps.secrets.get(scope, CREDENTIAL_KEY);
    if (!rawCreds) {
      return { ok: false as const, error: 'No credentials saved yet — save the key first.' };
    }
    let credentials: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawCreds.toString());
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
      credentials = parsed as Record<string, unknown>;
    } catch {
      return { ok: false as const, error: 'Saved credentials are unreadable.' };
    }
    // Operator-set credentials are sometimes saved without a `kind` field
    // (the UI used to PUT `{ key }` directly). Backfill from the manifest's
    // authKind so connectors that strictly check `credentials.kind` don't
    // see undefined.
    if (typeof credentials.kind !== 'string') {
      credentials.kind = provider.manifest.authKind;
    }
    const rawSettings = await loadConnectorSettings(req.deps.db, inst.capability, id);
    const settings = provider.manifest.settingsSchema.parse(rawSettings ?? {});

    try {
      await provider.verify({
        credentials: credentials as never,
        settings: settings as never,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      });
      await req.audit('admin.connector.test.ok', { id, providerSlug: inst.providerSlug });
      return { ok: true as const };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await req.audit('admin.connector.test.failed', { id, providerSlug: inst.providerSlug, error: message });
      return { ok: false as const, error: message };
    }
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

  // ---------- GET /api/providers ----------
  // List every framework-registered connector provider with its current
  // enable/disable state. Powers the Providers admin page. The Connectors
  // page filters by enabled (above); this page surfaces them all.
  app.get('/api/providers', { preHandler: requireUser }, async (req, reply) => {
    if (!require503(req.deps.inventory, reply, 'inventory')) return;
    reply.header('cache-control', 'no-store');

    const caps = ['email', 'email-inbox', 'crm', 'llm', 'file-storage'];
    const groups = await Promise.all(
      caps.map(async (capability) => {
        const providers = await Promise.all(
          req.deps.inventory!.listConnectorProviders(capability).map(async (p) => ({
            slug: p.manifest.slug,
            displayName: p.manifest.displayName,
            authKind: p.manifest.authKind,
            externalOAuth: p.manifest.externalOAuth,
            version: p.manifest.version,
            enabled: await isProviderEnabled(req.deps.db, capability, p.manifest.slug),
          })),
        );
        return { capability, providers };
      }),
    );
    return { capabilities: groups };
  });

  // ---------- PUT /api/providers/:capability/:slug ----------
  // Toggle a single provider's enabled state. Disabling does NOT delete
  // existing instances of that provider — operator does that explicitly
  // from the Connectors page. The instances keep working at runtime; they
  // just don't get new siblings until the provider is re-enabled.
  app.put(
    '/api/providers/:capability/:slug',
    { preHandler: requireUser },
    async (req, reply) => {
      if (!require503(req.deps.inventory, reply, 'inventory')) return;
      const { capability, slug } = req.params as { capability: string; slug: string };
      const body = z.object({ enabled: z.boolean() }).safeParse(req.body);
      if (!body.success) {
        reply.code(400).send({ error: 'invalid_input' });
        return;
      }
      // Refuse to operate on unknown providers — keeps the settings table
      // from accruing orphan rows for packages that aren't registered.
      try {
        req.deps.inventory.getConnectorProvider(capability, slug);
      } catch {
        reply.code(404).send({ error: 'unknown_provider' });
        return;
      }
      const scope = PROVIDER_ENABLED_SCOPE(capability, slug);
      await req.deps.db
        .insert(settingsTable)
        .values({ scope, value: { enabled: body.data.enabled } })
        .onConflictDoUpdate({
          target: settingsTable.scope,
          set: { value: { enabled: body.data.enabled }, updatedAt: new Date() },
        });
      await req.audit('admin.provider.enabled.update', {
        capability,
        slug,
        enabled: body.data.enabled,
      });
      return { ok: true as const, enabled: body.data.enabled };
    },
  );

  // ---------- GET /api/modules ----------
  // List registered modules so the UI can render their pages + nav entries.
  app.get('/api/modules', { preHandler: requireUser }, async (req, reply) => {
    if (!require503(req.deps.inventory, reply, 'inventory')) return;
    if (!req.deps.inventory.listModules) {
      return { modules: [] };
    }
    const out = await Promise.all(
      req.deps.inventory.listModules().map(async (mod) => {
        const scope = `module:${mod.manifest.slug}`;
        const rows = await req.deps.db
          .select({ value: settingsTable.value })
          .from(settingsTable)
          .where(eq(settingsTable.scope, scope))
          .limit(1);
        return {
          slug: mod.manifest.slug,
          version: mod.manifest.version,
          displayName: mod.manifest.displayName,
          description: mod.manifest.description,
          uiPages: mod.uiPages?.map((p) => ({ path: p.path, navLabel: p.navLabel })) ?? [],
          settings: rows[0]?.value ?? null,
          settingsSchema: zodToFieldSchema(
            mod.manifest.settingsSchema as Parameters<typeof zodToFieldSchema>[0],
          ),
        };
      }),
    );
    return { modules: out };
  });

  // ---------- PUT /api/modules/:slug/settings ----------
  app.put(
    '/api/modules/:slug/settings',
    { preHandler: requireUser },
    async (req, reply) => {
      if (!require503(req.deps.inventory, reply, 'inventory')) return;
      if (!req.deps.inventory.listModules || !req.deps.inventory.getModule) {
        reply.code(503).send({ error: 'modules_not_wired' });
        return;
      }
      const slug = (req.params as { slug: string }).slug;
      let mod;
      try {
        mod = req.deps.inventory.getModule(slug);
      } catch {
        reply.code(404).send({ error: 'module_not_found' });
        return;
      }
      const body = req.body as { value?: unknown };
      const parsed = (mod.manifest.settingsSchema as { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { issues: unknown } } }).safeParse(body?.value);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'settings_schema_violation',
          issues: parsed.error?.issues,
        });
        return;
      }
      const scope = `module:${slug}`;
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
      await req.audit('admin.module.settings.update', { slug });
      return { ok: true as const, settings: parsed.data };
    },
  );

  // ---------- GET /api/dashboard ----------
  // One round-trip overview used by the operator UI's landing page.
  app.get('/api/dashboard', { preHandler: requireUser }, async (req, reply) => {
    if (!require503(req.deps.inventory, reply, 'inventory')) return;

    const agents = req.deps.inventory.listAgents();
    const recentRuns = await req.deps.db
      .select({
        id: agentRuns.id,
        agentSlug: agentRuns.agentSlug,
        startedAt: agentRuns.startedAt,
        endedAt: agentRuns.endedAt,
        ok: agentRuns.ok,
        summary: agentRuns.summary,
      })
      .from(agentRuns)
      .orderBy(desc(agentRuns.startedAt))
      .limit(10);

    const instances = await req.deps.db.select().from(connectorInstances);
    const capabilityStatus: Array<{
      capability: string;
      registered: number;
      configured: number;
      activeProvider: string | null;
    }> = [];
    for (const cap of ['email', 'crm', 'llm', 'file-storage']) {
      const providers = req.deps.inventory.listConnectorProviders(cap);
      const capInstances = instances.filter((i) => i.capability === cap);
      const active = capInstances.find((i) => i.isActive);
      capabilityStatus.push({
        capability: cap,
        registered: providers.length,
        configured: capInstances.length,
        activeProvider: active ? active.providerSlug : null,
      });
    }

    return {
      agentCount: agents.length,
      recentRuns,
      capabilities: capabilityStatus,
    };
  });

  // ---------- GET /api/audit ----------
  app.get('/api/audit', { preHandler: requireUser }, async (req) => {
    const q = req.query as {
      limit?: string;
      action?: string;
      userId?: string;
      agentSlug?: string;
      since?: string;
      before?: string;
    };
    const limit = Math.min(Math.max(Number(q.limit ?? 100), 1), 500);

    const filters: SQL[] = [];
    if (q.action) filters.push(eq(auditLog.action, q.action));
    if (q.userId) filters.push(eq(auditLog.userId, q.userId));
    if (q.agentSlug) filters.push(eq(auditLog.agentSlug, q.agentSlug));
    if (q.since) {
      const t = new Date(q.since);
      if (!Number.isNaN(t.getTime())) filters.push(gte(auditLog.at, t));
    }
    if (q.before) {
      const t = new Date(q.before);
      if (!Number.isNaN(t.getTime())) filters.push(lt(auditLog.at, t));
    }

    const rowsQuery = req.deps.db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        action: auditLog.action,
        userId: auditLog.userId,
        userEmail: users.email,
        agentSlug: auditLog.agentSlug,
        requestId: auditLog.requestId,
        meta: auditLog.meta,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.userId, users.id))
      .orderBy(desc(auditLog.at))
      .limit(limit);
    const rows = await (filters.length
      ? rowsQuery.where(and(...filters))
      : rowsQuery);
    const nextBefore =
      rows.length === limit && rows[rows.length - 1]
        ? rows[rows.length - 1]!.at.toISOString()
        : null;
    return { entries: rows, nextBefore };
  });
}
