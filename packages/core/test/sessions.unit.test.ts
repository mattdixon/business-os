import { describe, it, expect } from 'vitest';
import {
  newSessionToken,
  hashSessionToken,
  SESSION_TOKEN_BYTES,
} from '../src/auth/sessions.js';

describe('session tokens', () => {
  it('produces hex tokens of the right length', () => {
    const t = newSessionToken();
    expect(t).toMatch(/^[0-9a-f]+$/);
    expect(t.length).toBe(SESSION_TOKEN_BYTES * 2);
  });

  it('produces unique tokens', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(newSessionToken());
    expect(seen.size).toBe(100);
  });

  it('hashSessionToken is deterministic and 64 hex chars (sha256)', () => {
    const t = 'a'.repeat(64);
    const h1 = hashSessionToken(t);
    const h2 = hashSessionToken(t);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe(t); // never store raw
  });
});
