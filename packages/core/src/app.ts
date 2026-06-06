import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '@business-os/db';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerUiServe } from './ui-serve.js';
import type { SecretsStore } from './secrets/index.js';
import { audit, type AuditContext } from './audit/index.js';
import type { AgentInventory, ManualTriggerer } from './inventory.js';

export const SESSION_COOKIE = 'bos_sess';

export interface AppDeps {
  db: Db;
  secrets: SecretsStore;
  /** 32-byte symmetric key used to encrypt TOTP secrets at rest. */
  encryptionKey: Uint8Array;
  clientSlug: string;
  /** Brand name shown in TOTP enrollment. Defaults to "Business OS". */
  issuer?: string;
  /** Override the built-in cookie security default (true outside dev). */
  cookieSecure?: boolean;
  /** Fastify logger options. Tests pass `false` to silence. */
  logger?: boolean | { level?: string };
  /**
   * Serve @business-os/ui static assets at /. Default true outside tests.
   * Tests typically set this false to keep the app surface API-only.
   */
  serveUi?: boolean;
  /**
   * Inventory of what's registered (agents, connectors). The runtime's
   * Registry satisfies this. When omitted, admin endpoints that need it
   * return 503 — useful for tests of the auth-only surface.
   */
  inventory?: AgentInventory;
  /**
   * Manual run dispatcher. The runtime's Scheduler satisfies this. When
   * omitted, `POST /api/agents/:slug/run` returns 503.
   */
  trigger?: ManualTriggerer;
}

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    deps: AppDeps;
    user?: { id: string; email: string } | null;
    audit(action: string, meta?: Record<string, unknown>): Promise<void>;
  }
}

const SELECT_ONE = sql`SELECT 1`;

function defaultLoggerOpts(clientSlug: string): Record<string, unknown> {
  return {
    level: process.env.LOG_LEVEL ?? 'info',
    base: { client_slug: clientSlug },
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        '*.password',
        '*.totp',
        '*.token',
      ],
      censor: '[REDACTED]',
    },
    formatters: {
      level: (label: string) => ({ level: label }),
    },
  };
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const loggerOpt =
    deps.logger === false
      ? false
      : {
          ...defaultLoggerOpts(deps.clientSlug),
          ...(typeof deps.logger === 'object' ? deps.logger : {}),
        };

  const opts: FastifyServerOptions = {
    logger: loggerOpt as FastifyServerOptions['logger'],
    genReqId: (req) =>
      (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    trustProxy: true,
  };
  const app = Fastify(opts);

  app.addHook('onRequest', async (req) => {
    req.requestId = req.id as string;
    req.deps = deps;
    req.user = null;
    req.audit = async (action, meta) => {
      const ctx: AuditContext = {
        db: deps.db,
        requestId: req.requestId,
        userId: req.user?.id ?? null,
      };
      return audit(ctx, action, meta);
    };
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-request-id', req.requestId);
    return payload;
  });

  app.get('/healthz', async () => ({ ok: true }));

  app.get('/readyz', async (req, reply) => {
    try {
      await req.deps.db.execute(SELECT_ONE);
      return { ok: true, db: 'up' };
    } catch (err) {
      req.log.error({ err }, 'readyz: db ping failed');
      reply.code(503);
      return { ok: false, db: 'down' };
    }
  });

  registerAuthRoutes(app);
  registerAdminRoutes(app);

  if (deps.serveUi !== false) {
    registerUiServe(app);
  }

  return app;
}
