import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '@frontrangesystems/business-os-db';
import { agentRuns, settings as settingsTable } from '@frontrangesystems/business-os-db';
import type {
  AgentContext,
  AgentResult,
  Logger as AgentLogger,
} from '@frontrangesystems/business-os-agent-sdk';
import type { ConnectorCapabilityMap } from '@frontrangesystems/business-os-connector-sdk';
import type { Logger } from 'pino';
import { audit, type AuditContext } from '@frontrangesystems/business-os-core/audit';
import type { Registry } from './registry.js';
import type { ConnectorResolver } from './active-connectors.js';

export interface RunAgentDeps {
  db: Db;
  registry: Registry;
  connectors: ConnectorResolver;
  logger: Logger;
  /**
   * Optional jobs backend. When provided, agents that call ctx.jobs.enqueue
   * persist work durably. When omitted, enqueue throws — useful for unit
   * tests that don't exercise the queue.
   */
  jobs?: { enqueue(name: string, payload: unknown, opts?: { delayMs?: number; idempotencyKey?: string }): Promise<string> };
  /**
   * Optional error sink. When provided, runAgent calls this whenever an
   * agent throws — used by client shells to forward to Sentry (via
   * captureAgentError in @frontrangesystems/business-os-core/sentry).
   */
  onAgentError?: (err: unknown, ctx: { agentSlug: string; runId: string }) => void;
}

export interface RunTrigger {
  kind: 'cron' | 'manual' | 'event';
  /** cron expression, user-id for manual, or topic for event */
  detail: string;
  /** When kind === 'manual', the user that pressed "Run now" */
  triggeredBy?: string;
}

const SETTINGS_SCOPE = (slug: string): string => `agent:${slug}`;

function adaptLogger(p: Logger): AgentLogger {
  return {
    trace: (o, m) => p.trace(o as object, m),
    debug: (o, m) => p.debug(o as object, m),
    info: (o, m) => p.info(o as object, m),
    warn: (o, m) => p.warn(o as object, m),
    error: (o, m) => p.error(o as object, m),
  };
}

/**
 * Runs an agent end-to-end:
 *   1. Inserts an agent_runs row (status: in-flight, no end yet).
 *   2. Loads + validates settings against the manifest schema.
 *   3. Builds the AgentContext: logger, db, connector resolver, audit, jobs.
 *   4. Calls agent.run(ctx, input).
 *   5. Stamps the agent_runs row with ok/summary/details/ended_at.
 *
 * Throws are caught: a thrown agent error is recorded as ok=false on the row
 * (and re-thrown for the scheduler's own bookkeeping).
 */
export async function runAgent(
  deps: RunAgentDeps,
  slug: string,
  input: unknown,
  trigger: RunTrigger,
): Promise<{ runId: string; result: AgentResult }> {
  const agent = deps.registry.getAgent(slug);
  const runId = randomUUID();

  await deps.db.insert(agentRuns).values({
    id: runId,
    agentSlug: slug,
    trigger: `${trigger.kind}:${trigger.detail}`,
    triggeredBy: trigger.triggeredBy,
  });

  // Settings (parsed against the manifest's schema; agent never sees raw JSON).
  const rows = await deps.db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.scope, SETTINGS_SCOPE(slug)))
    .limit(1);
  const rawSettings = rows[0]?.value ?? {};
  const settings = agent.manifest.settingsSchema.parse(rawSettings);

  // Optionally validate input against the agent's inputSchema before calling run().
  const validatedInput = agent.manifest.inputSchema
    ? agent.manifest.inputSchema.parse(input)
    : input;

  const childLogger = deps.logger.child({ agent_slug: slug, run_id: runId });

  const ctx: AgentContext = {
    settings,
    logger: adaptLogger(childLogger),
    connector: (<C extends keyof ConnectorCapabilityMap>(
      capability: C,
      opts?: { providerSlug?: string },
    ) =>
      deps.connectors.resolve(capability, {
        ...opts,
        // Scope to this agent so the resolver uses its bindings (and fails
        // loud if a required capability has no binding set).
        agentSlug: slug,
      })) as unknown as AgentContext['connector'],
    db: deps.db,
    audit: async (action, meta) => {
      const ac: AuditContext = {
        db: deps.db,
        requestId: runId, // run_id correlates with logs
        userId: trigger.triggeredBy ?? null,
        agentSlug: slug,
      };
      await audit(ac, action, meta);
    },
    jobs: {
      enqueue: deps.jobs
        ? (name, payload, opts) => deps.jobs!.enqueue(name, payload, opts)
        : async () => {
            throw new Error(
              'jobs.enqueue: no jobs backend wired. Pass `jobs` to runAgent() or use createJobsBackend().',
            );
          },
    },
    runId,
    // Read-only view of registered modules — used by framework agents that
    // coordinate across modules (currently just the digest agent). Routes
    // and uiPages are filtered out; only slug + displayName + digestContribution
    // are exposed.
    modules: deps.registry.listModules().map((m) => ({
      slug: m.manifest.slug,
      displayName: m.manifest.displayName,
      digestContribution: m.digestContribution as
        | ((ctx: { user: { id: string; email: string }; since: Date; logger: AgentLogger; settings: unknown }) => Promise<{
            sectionTitle: string;
            summary?: string;
            items: Array<{ title: string; subtitle?: string; href: string; isUrgent?: boolean }>;
          } | null>)
        | undefined,
    })),
  };

  try {
    const result = await agent.run(ctx, validatedInput);
    await deps.db
      .update(agentRuns)
      .set({
        endedAt: new Date(),
        ok: result.ok,
        summary: result.summary,
        details: result.details ?? null,
      })
      .where(eq(agentRuns.id, runId));
    childLogger.info({ ok: result.ok, summary: result.summary }, 'agent.run finished');
    return { runId, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.db
      .update(agentRuns)
      .set({
        endedAt: new Date(),
        ok: false,
        summary: `error: ${message}`,
        details: { error: message },
      })
      .where(eq(agentRuns.id, runId));
    childLogger.error({ err }, 'agent.run threw');
    if (deps.onAgentError) {
      try {
        deps.onAgentError(err, { agentSlug: slug, runId });
      } catch {
        // never let an error sink mask the original throw
      }
    }
    throw err;
  }
}
