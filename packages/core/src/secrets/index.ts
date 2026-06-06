import { createRequire } from 'node:module';
// libsodium-wrappers' published ESM build (0.7.16) does `import "./libsodium.mjs"`
// expecting a sibling that lives in a different pnpm package and is therefore
// not co-located. The CJS build works fine, so we load it via createRequire.
const require = createRequire(import.meta.url);
const sodium = require('libsodium-wrappers') as typeof import('libsodium-wrappers');
import { eq, and } from 'drizzle-orm';
import type { Db } from '@business-os/db';
import { secrets } from '@business-os/db';

/**
 * Symmetric encryption for secrets at rest.
 *
 * Algorithm: libsodium `crypto_secretbox_easy` — XSalsa20 + Poly1305.
 * The key is 32 random bytes, base64 in the `SECRETS_KEY` env var.
 * Each value gets a fresh 24-byte nonce; ciphertext+nonce are stored together.
 *
 * We intentionally store key+nonce as base64 text columns (not bytea) to keep
 * the rows easy to dump/inspect during ops without binary tooling.
 */

let _ready: Promise<void> | null = null;
async function ready(): Promise<void> {
  if (!_ready) _ready = sodium.ready;
  await _ready;
}

export class SecretsKeyMissingError extends Error {
  constructor() {
    super(
      'SECRETS_KEY is not set. Generate one with: ' +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
    this.name = 'SecretsKeyMissingError';
  }
}

export class SecretsKeyInvalidError extends Error {
  constructor(reason: string) {
    super(`SECRETS_KEY is invalid: ${reason}`);
    this.name = 'SecretsKeyInvalidError';
  }
}

export class SecretsDecryptError extends Error {
  constructor(scope: string, key: string) {
    super(
      `Failed to decrypt secret "${scope}/${key}". ` +
        `This usually means SECRETS_KEY was rotated without re-encrypting stored secrets.`,
    );
    this.name = 'SecretsDecryptError';
  }
}

export function loadSecretsKey(env: NodeJS.ProcessEnv = process.env): Uint8Array {
  const raw = env.SECRETS_KEY;
  if (!raw) throw new SecretsKeyMissingError();
  let bytes: Uint8Array;
  try {
    bytes = Buffer.from(raw, 'base64');
  } catch {
    throw new SecretsKeyInvalidError('not valid base64');
  }
  if (bytes.length !== 32) {
    throw new SecretsKeyInvalidError(
      `decoded length ${bytes.length}, expected 32 (256 bits)`,
    );
  }
  return bytes;
}

export interface EncryptedPayload {
  ciphertext: string; // base64
  nonce: string;      // base64
}

export async function sealString(plaintext: string, key: Uint8Array): Promise<EncryptedPayload> {
  await ready();
  if (key.length !== 32) throw new SecretsKeyInvalidError(`runtime key wrong length: ${key.length}`);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, key);
  return {
    ciphertext: Buffer.from(ct).toString('base64'),
    nonce: Buffer.from(nonce).toString('base64'),
  };
}

export async function openString(
  payload: EncryptedPayload,
  key: Uint8Array,
  ctxForError: { scope: string; key: string },
): Promise<string> {
  await ready();
  const ct = Buffer.from(payload.ciphertext, 'base64');
  const nonce = Buffer.from(payload.nonce, 'base64');
  try {
    const pt = sodium.crypto_secretbox_open_easy(ct, nonce, key);
    return sodium.to_string(pt);
  } catch {
    throw new SecretsDecryptError(ctxForError.scope, ctxForError.key);
  }
}

// -----------------------------------------------------------------------------
// SecretsStore: DB-backed get/put keyed by (scope, key)
// -----------------------------------------------------------------------------

export interface SecretsStore {
  put(scope: string, key: string, plaintext: string): Promise<void>;
  get(scope: string, key: string): Promise<string | null>;
  delete(scope: string, key: string): Promise<void>;
  listScope(scope: string): Promise<string[]>;
}

export function createSecretsStore(db: Db, key: Uint8Array): SecretsStore {
  return {
    async put(scope, k, plaintext) {
      const payload = await sealString(plaintext, key);
      // Upsert: (scope, key) is unique. On conflict, rewrite ciphertext/nonce.
      await db
        .insert(secrets)
        .values({
          scope,
          key: k,
          ciphertext: payload.ciphertext,
          nonce: payload.nonce,
        })
        .onConflictDoUpdate({
          target: [secrets.scope, secrets.key],
          set: {
            ciphertext: payload.ciphertext,
            nonce: payload.nonce,
            updatedAt: new Date(),
          },
        });
    },
    async get(scope, k) {
      const rows = await db
        .select({ ciphertext: secrets.ciphertext, nonce: secrets.nonce })
        .from(secrets)
        .where(and(eq(secrets.scope, scope), eq(secrets.key, k)))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return openString(row, key, { scope, key: k });
    },
    async delete(scope, k) {
      await db.delete(secrets).where(and(eq(secrets.scope, scope), eq(secrets.key, k)));
    },
    async listScope(scope) {
      const rows = await db
        .select({ key: secrets.key })
        .from(secrets)
        .where(eq(secrets.scope, scope));
      return rows.map((r: { key: string }) => r.key);
    },
  };
}
