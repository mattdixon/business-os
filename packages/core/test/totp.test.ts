import { describe, it, expect } from 'vitest';
import * as OTPAuth from 'otpauth';
import { generateTotpSecret, verifyTotpCode } from '../src/auth/totp.js';

describe('TOTP', () => {
  it('generates a base32 secret and an otpauth URI', () => {
    const { secret, otpauthUri } = generateTotpSecret({
      issuer: 'Business OS',
      accountName: 'matt@example.com',
    });
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//);
  });

  it('verifies the current code', () => {
    const { secret } = generateTotpSecret({ issuer: 'i', accountName: 'a' });
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
      digits: 6,
      period: 30,
      algorithm: 'SHA1',
    });
    const code = totp.generate();
    expect(verifyTotpCode(secret, code)).toBe(true);
  });

  it('rejects a wrong code', () => {
    const { secret } = generateTotpSecret({ issuer: 'i', accountName: 'a' });
    expect(verifyTotpCode(secret, '000000')).toBe(false);
  });
});
