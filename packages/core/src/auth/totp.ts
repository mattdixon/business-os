import * as OTPAuth from 'otpauth';
import { eq } from 'drizzle-orm';
import type { Db } from '@business-os/db';
import { users } from '@business-os/db';
import { sealString, openString, type EncryptedPayload } from '../secrets/index.js';

/**
 * TOTP per RFC 6238: SHA-1, 30-second period, 6 digits. We accept a ±1 step
 * window to tolerate clock skew. Secret is 160 bits, base32-encoded.
 *
 * Stored encrypted in users.totp_secret_encrypted as JSON ("ciphertext|nonce")
 * so we don't need a separate column or table for the nonce.
 */

const PERIOD = 30;
const DIGITS = 6;
const WINDOW = 1;

export interface TotpEnrollment {
  /** Base32 secret to display once to the user. */
  secret: string;
  /** otpauth:// URI suitable for QR rendering. */
  otpauthUri: string;
}

export function generateTotpSecret(opts: {
  issuer: string;
  accountName: string;
}): TotpEnrollment {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: opts.issuer,
    label: opts.accountName,
    secret,
    digits: DIGITS,
    period: PERIOD,
    algorithm: 'SHA1',
  });
  return { secret: secret.base32, otpauthUri: totp.toString() };
}

export function verifyTotpCode(secretBase32: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secretBase32),
    digits: DIGITS,
    period: PERIOD,
    algorithm: 'SHA1',
  });
  return totp.validate({ token: code, window: WINDOW }) !== null;
}

// -----------------------------------------------------------------------------
// DB-backed helpers
// -----------------------------------------------------------------------------

function pack(p: EncryptedPayload): string {
  return `${p.ciphertext}|${p.nonce}`;
}
function unpack(s: string): EncryptedPayload {
  const i = s.indexOf('|');
  if (i < 0) throw new Error('malformed totp secret payload');
  return { ciphertext: s.slice(0, i), nonce: s.slice(i + 1) };
}

export async function setUserTotpSecret(
  db: Db,
  userId: string,
  secretBase32: string,
  encryptionKey: Uint8Array,
): Promise<void> {
  const sealed = await sealString(secretBase32, encryptionKey);
  await db
    .update(users)
    .set({ totpSecretEncrypted: pack(sealed), updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function getUserTotpSecret(
  db: Db,
  userId: string,
  encryptionKey: Uint8Array,
): Promise<string | null> {
  const rows = await db
    .select({ secret: users.totpSecretEncrypted })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const row = rows[0];
  if (!row?.secret) return null;
  return openString(unpack(row.secret), encryptionKey, { scope: 'user:totp', key: userId });
}

export async function clearUserTotpSecret(db: Db, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ totpSecretEncrypted: null, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
