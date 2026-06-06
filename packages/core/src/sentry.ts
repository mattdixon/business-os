import * as Sentry from '@sentry/node';
import type { FastifyInstance, FastifyError } from 'fastify';

/**
 * Sentry integration.
 *
 * Per CLAUDE.md: "Errors: Sentry, tagged with client_slug and agent_slug."
 *
 * Behavior:
 *   - When SENTRY_DSN is empty/unset, this is a no-op. No SDK init, no overhead.
 *   - When set, captures Fastify unhandled errors and request-level exceptions
 *     with client_slug as a tag on every event. Agent slugs are attached per
 *     event via the Sentry scope inside runAgent on the runtime side
 *     (forwarded via Pino logger.error and the captureAgentError helper).
 *   - Auth tokens, cookies, and passwords are stripped from the request via
 *     beforeSend — defense in depth on top of Pino's redactions.
 */

export interface SentryOpts {
  dsn?: string;
  clientSlug: string;
  /** Defaults to NODE_ENV. */
  environment?: string;
  /** Defaults to 1.0 in development, 0.05 in production. */
  tracesSampleRate?: number;
}

let initialized = false;

export function initSentry(opts: SentryOpts): boolean {
  if (initialized) return true;
  if (!opts.dsn) return false;
  const env = opts.environment ?? process.env.NODE_ENV ?? 'development';
  Sentry.init({
    dsn: opts.dsn,
    environment: env,
    tracesSampleRate:
      opts.tracesSampleRate ?? (env === 'production' ? 0.05 : 1.0),
    initialScope: {
      tags: { client_slug: opts.clientSlug },
    },
    beforeSend(event) {
      // Defense-in-depth: strip cookies + auth headers + obvious password fields.
      if (event.request?.headers) {
        const h = event.request.headers as Record<string, string | undefined>;
        delete h.cookie;
        delete h.authorization;
        delete h['x-api-key'];
      }
      if (event.request?.data && typeof event.request.data === 'object') {
        const d = event.request.data as Record<string, unknown>;
        for (const k of ['password', 'totp', 'token', 'apiKey', 'api_key', 'key']) {
          if (k in d) d[k] = '[REDACTED]';
        }
      }
      return event;
    },
  });
  initialized = true;
  return true;
}

export function registerFastifySentry(app: FastifyInstance): void {
  if (!initialized) return;
  app.addHook('onError', async (request, _reply, error: FastifyError) => {
    Sentry.withScope((scope) => {
      scope.setTag('request_id', request.requestId);
      if (request.user) scope.setUser({ id: request.user.id, email: request.user.email });
      scope.setExtras({
        url: request.raw.url,
        method: request.method,
      });
      Sentry.captureException(error);
    });
  });
}

/**
 * Helper for the runtime: captures an agent error with the right tags.
 * The runtime can call this from its catch block in runAgent.
 */
export function captureAgentError(
  err: unknown,
  ctx: { agentSlug: string; runId: string; clientSlug?: string },
): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    scope.setTag('agent_slug', ctx.agentSlug);
    scope.setTag('run_id', ctx.runId);
    if (ctx.clientSlug) scope.setTag('client_slug', ctx.clientSlug);
    Sentry.captureException(err);
  });
}

/** Flush pending events on shutdown. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) return;
  await Sentry.flush(timeoutMs);
}
