import { eq, and } from 'drizzle-orm';
import type { Db } from '@frontrangesystems/business-os-db';
import { users, type User } from '@frontrangesystems/business-os-db';
import { hashPassword, verifyPassword } from './passwords.js';

export async function createUser(
  db: Db,
  args: { email: string; password: string; displayName?: string },
): Promise<User> {
  const passwordHash = await hashPassword(args.password);
  const rows = await db
    .insert(users)
    .values({
      email: args.email.trim().toLowerCase(),
      passwordHash,
      displayName: args.displayName,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error('createUser: insert returned no row');
  return row;
}

export async function findUserByEmail(db: Db, email: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email.trim().toLowerCase()), eq(users.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Verify a (email, password) pair. Constant-ish time: if the email is unknown,
 * we still run argon2.verify against a fixed dummy hash so attackers can't use
 * timing to enumerate accounts.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$ZHVtbXktc2FsdC1mb3ItdGltaW5n$Lcj6ag9DZszMz3wlAh3z58z3o0srhKZqEi8N7w0u4Eo';

export async function verifyEmailPassword(
  db: Db,
  email: string,
  password: string,
): Promise<User | null> {
  const user = await findUserByEmail(db, email);
  if (!user) {
    await verifyPassword(DUMMY_HASH, password); // burn the time
    return null;
  }
  const ok = await verifyPassword(user.passwordHash, password);
  return ok ? user : null;
}
