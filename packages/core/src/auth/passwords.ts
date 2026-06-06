import argon2 from 'argon2';

/**
 * Argon2id at OWASP-recommended parameters (2024):
 *   memory  ≥ 19 MiB, iterations ≥ 2, parallelism = 1.
 * We pick a higher memory cost (64 MiB) because the API runs on a single
 * server we control, not a shared host.
 */
const OPTS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024, // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Malformed hash: treat as no-match, don't leak via 500.
    return false;
  }
}
