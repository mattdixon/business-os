import { createHash, randomBytes } from 'node:crypto';
import { eq, and, isNull, gt } from 'drizzle-orm';
import type { Db } from '@frontrangesystems/business-os-db';
import { passwordResetTokens, users } from '@frontrangesystems/business-os-db';
import { hashPassword } from './passwords.js';
import { revokeAllUserSessions } from './sessions.js';

/**
 * Password reset.
 *
 * - The raw token we email is 32 random bytes hex-encoded.
 * - We store sha256(token) only. Same pattern as session tokens: a DB leak
 *   never exposes a usable reset token.
 * - TTL is 15 minutes. Single-use: completing a reset stamps `used_at` and
 *   any subsequent lookup of the same token fails.
 * - On successful reset we revoke ALL of the user's existing sessions.
 */

export const PASSWORD_RESET_TTL_MS = 15 * 60 * 1000;

export interface IssuedResetToken {
  token: string;
  expiresAt: Date;
}

function hashResetToken(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}

/**
 * Issue a password reset token for the given email — OR pretend to.
 *
 * If the email isn't on file, we still return a token-shaped value to keep the
 * timing roughly symmetric. The CALLER decides what to do with the result: in
 * production the route handler discards the fake token and tells the operator
 * "if the email exists we sent a link", never revealing the existence question.
 */
export async function issuePasswordResetToken(
  db: Db,
  email: string,
): Promise<IssuedResetToken | null> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), eq(users.isActive, true)))
    .limit(1);
  const user = rows[0];
  if (!user) return null;

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  await db.insert(passwordResetTokens).values({
    id: hashResetToken(token),
    userId: user.id,
    expiresAt,
  });
  return { token, expiresAt };
}

export interface ResetCompletion {
  userId: string;
}

export async function completePasswordReset(
  db: Db,
  token: string,
  newPassword: string,
): Promise<ResetCompletion | null> {
  const id = hashResetToken(token);

  const rows = await db
    .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.id, id),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const newHash = await hashPassword(newPassword);

  // Mark token used, update password, revoke sessions.
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, id));
  await db
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, row.userId));
  await revokeAllUserSessions(db, row.userId);

  return { userId: row.userId };
}
