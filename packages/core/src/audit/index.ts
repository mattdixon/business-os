import type { Db } from '@frontrangesystems/business-os-db';
import { auditLog } from '@frontrangesystems/business-os-db';

/**
 * Audit log helper.
 *
 * Per CLAUDE.md: "Every state-changing API call MUST result in an audit-log row.
 * Use the audit-log helper; don't write rows directly."
 *
 * This is the helper. Routes call `audit(ctx, 'auth.login', { ... })` and the
 * helper attaches the request_id, user_id, and agent_slug from the ambient
 * AuditContext that the Fastify request lifecycle builds up.
 */

export interface AuditContext {
  db: Db;
  requestId: string;
  userId?: string | null;
  agentSlug?: string | null;
}

export async function audit(
  ctx: AuditContext,
  action: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  await ctx.db.insert(auditLog).values({
    action,
    userId: ctx.userId ?? null,
    agentSlug: ctx.agentSlug ?? null,
    requestId: ctx.requestId,
    meta: meta ?? null,
  });
}
