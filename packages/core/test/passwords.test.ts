import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/passwords.js';

describe('argon2id password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('abc123abc123');
    expect(await verifyPassword(hash, 'abc123abc124')).toBe(false);
  });

  it('returns false (not throws) for a malformed hash', async () => {
    expect(await verifyPassword('not-a-real-argon2-hash', 'x')).toBe(false);
  });
}, 30_000);
