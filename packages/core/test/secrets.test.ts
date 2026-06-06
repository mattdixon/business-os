import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  loadSecretsKey,
  sealString,
  openString,
  SecretsKeyMissingError,
  SecretsKeyInvalidError,
  SecretsDecryptError,
} from '../src/secrets/index.js';

function freshKey(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

describe('loadSecretsKey', () => {
  it('throws when SECRETS_KEY missing', () => {
    expect(() => loadSecretsKey({})).toThrow(SecretsKeyMissingError);
  });

  it('throws when not 32 bytes after base64 decode', () => {
    expect(() => loadSecretsKey({ SECRETS_KEY: Buffer.from('short').toString('base64') })).toThrow(
      SecretsKeyInvalidError,
    );
  });

  it('accepts a valid base64 32-byte key', () => {
    const env = { SECRETS_KEY: Buffer.from(randomBytes(32)).toString('base64') };
    const out = loadSecretsKey(env);
    expect(out.length).toBe(32);
  });
});

describe('seal/open roundtrip', () => {
  it('roundtrips a string', async () => {
    const key = freshKey();
    const sealed = await sealString('hunter2', key);
    const back = await openString(sealed, key, { scope: 's', key: 'k' });
    expect(back).toBe('hunter2');
  });

  it('produces unique nonces (and ciphertexts) for the same plaintext', async () => {
    const key = freshKey();
    const a = await sealString('same', key);
    const b = await sealString('same', key);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('rejects ciphertext under a different key with SecretsDecryptError', async () => {
    const k1 = freshKey();
    const k2 = freshKey();
    const sealed = await sealString('x', k1);
    await expect(
      openString(sealed, k2, { scope: 'wrong-key', key: 'k' }),
    ).rejects.toBeInstanceOf(SecretsDecryptError);
  });

  it('rejects tampered ciphertext', async () => {
    const key = freshKey();
    const sealed = await sealString('important', key);
    const tampered = {
      ...sealed,
      ciphertext: Buffer.from(
        Buffer.from(sealed.ciphertext, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b)),
      ).toString('base64'),
    };
    await expect(
      openString(tampered, key, { scope: 't', key: 'k' }),
    ).rejects.toBeInstanceOf(SecretsDecryptError);
  });

  it('roundtrips unicode payloads', async () => {
    const key = freshKey();
    const payload = 'こんにちは — 🦀 — Σ(x²)';
    const sealed = await sealString(payload, key);
    const back = await openString(sealed, key, { scope: 'u', key: 'k' });
    expect(back).toBe(payload);
  });
});
