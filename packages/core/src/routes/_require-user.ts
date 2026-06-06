import type { FastifyRequest, FastifyReply } from 'fastify';
import { SESSION_COOKIE } from '../app.js';
import { lookupSession } from '../auth/sessions.js';

/**
 * Shared preHandler: requires a valid session cookie. Populates req.user.
 * Replies 401 if missing/invalid.
 */
export async function requireUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const raw = req.headers.cookie;
  let token: string | null = null;
  if (raw) {
    for (const part of raw.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === SESSION_COOKIE) {
        token = rest.join('=');
        break;
      }
    }
  }
  if (!token) {
    reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  const lookup = await lookupSession(req.deps.db, token);
  if (!lookup) {
    reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  req.user = { id: lookup.user.id, email: lookup.user.email };
}
