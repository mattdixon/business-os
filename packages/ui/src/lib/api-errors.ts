import { ApiError } from './api';

/**
 * Pull a friendly message out of an ApiError that may carry Zod issues or
 * server-set machine + human codes.
 *
 * Server convention: error responses look like
 *   { error: 'verify_failed', message: '401 Invalid API key' }
 * where `error` is the machine-readable slug (which ends up on `e.message`
 * from the API client) and `message` is the operator-facing detail.
 * Prefer `body.message` so the operator sees "401 Invalid API key" instead
 * of the bare "verify_failed".
 *
 * For Zod validation errors the body looks like
 *   { error: 'invalid_input', issues: [{ path: ['foo'], message: 'Required' }] }
 * — we join the issues into "foo: Required; bar: ...".
 */
export function apiErrorMessage(e: unknown, fallback: string): string {
  if (!(e instanceof ApiError)) return fallback;
  const body = e.body as {
    issues?: Array<{ path?: string[]; message?: string }>;
    message?: string;
  } | null;
  if (body?.issues?.length) {
    return body.issues
      .map((i) => `${i.path?.join('.') ?? 'value'}: ${i.message ?? 'invalid'}`)
      .join('; ');
  }
  if (body?.message) return body.message;
  return e.message || fallback;
}
