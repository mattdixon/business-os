import { z } from 'zod';

/**
 * Framework-level env contract. A client shell's index.ts hands its own env
 * (typically `process.env`) to startServer; this schema is what we enforce.
 *
 * Client-custom env vars (per-agent flags, deploy-specific things) are not
 * validated here — agents read them through their own settings or via the
 * connector context, not by reading process.env directly.
 */

export const FrameworkEnvSchema = z.object({
  DATABASE_URL: z.string().min(10),
  /** Base64-encoded 32 random bytes (libsodium key). */
  SECRETS_KEY: z.string().min(40),
  CLIENT_SLUG: z.string().min(1).default('dev'),
  CLIENT_NAME: z.string().min(1).default('Dev Harness'),
  API_PORT: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 4673))
    .pipe(z.number().int().min(1).max(65535)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  SENTRY_DSN: z.string().optional(),
});

export type FrameworkEnv = z.infer<typeof FrameworkEnvSchema>;

export function parseEnv(env: NodeJS.ProcessEnv = process.env): FrameworkEnv {
  const parsed = FrameworkEnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Framework env is invalid:\n${issues}`);
  }
  return parsed.data;
}
