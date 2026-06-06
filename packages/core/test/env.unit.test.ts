import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/boot/env.js';

const GOOD_KEY = Buffer.alloc(32).toString('base64');

describe('parseEnv', () => {
  it('parses a minimal valid env', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgres://x:y@localhost:5432/biz',
      SECRETS_KEY: GOOD_KEY,
    });
    expect(env.DATABASE_URL).toMatch(/^postgres:\/\//);
    expect(env.SECRETS_KEY).toBe(GOOD_KEY);
    expect(env.CLIENT_SLUG).toBe('dev');
    expect(env.API_PORT).toBe(4673);
    expect(env.NODE_ENV).toBe('development');
  });

  it('honors API_PORT override and coerces to number', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgres://x:y@h:5432/b',
      SECRETS_KEY: GOOD_KEY,
      API_PORT: '8421',
    });
    expect(env.API_PORT).toBe(8421);
  });

  it('rejects missing DATABASE_URL with a helpful error', () => {
    expect(() =>
      parseEnv({ SECRETS_KEY: GOOD_KEY } as never),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects too-short SECRETS_KEY', () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: 'postgres://x:y@h:5432/b',
        SECRETS_KEY: 'short',
      }),
    ).toThrow(/SECRETS_KEY/);
  });

  it('rejects invalid NODE_ENV', () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: 'postgres://x:y@h:5432/b',
        SECRETS_KEY: GOOD_KEY,
        NODE_ENV: 'staging',
      }),
    ).toThrow(/NODE_ENV/);
  });
});
