import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { buildApp, SESSION_COOKIE } from '../src/app.js';
import { createSecretsStore } from '../src/secrets/index.js';
import { createUser } from '../src/auth/users.js';
import { freshDb, pgReachable, TEST_DATABASE_URL } from './_db.js';

const reachable = await pgReachable(TEST_DATABASE_URL);
const d = reachable ? describe : describe.skip;

if (!reachable) {
  // eslint-disable-next-line no-console
  console.warn(
    `[core.integration] Skipping: Postgres unreachable at ${TEST_DATABASE_URL}. ` +
      `Start it with \`docker compose up -d postgres\` to run these tests.`,
  );
}

function readSetCookie(setCookie: string | string[] | undefined): string | null {
  if (!setCookie) return null;
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) return null;
  const m = header.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return m?.[1] ?? null;
}

d('auth routes (real Postgres)', () => {
  let env: Awaited<ReturnType<typeof freshDb>>;
  let app: ReturnType<typeof buildApp>;
  const encryptionKey = new Uint8Array(randomBytes(32));

  beforeAll(async () => {
    env = await freshDb();
    const secrets = createSecretsStore(env.db, encryptionKey);
    app = buildApp({
      db: env.db,
      secrets,
      encryptionKey,
      clientSlug: 'test',
      logger: false,
    });
    await app.ready();
    await createUser(env.db, {
      email: 'matt@example.com',
      password: 'correct-horse-battery-staple',
      displayName: 'Matt',
    });
  });

  afterAll(async () => {
    await app.close();
    await env.sql.end({ timeout: 1 });
  });

  it('GET /healthz returns ok', async () => {
    const r = await app.inject({ method: 'GET', url: '/healthz' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    expect(r.headers['x-request-id']).toBeTypeOf('string');
  });

  it('rejects login with wrong password (and audits the failure)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'matt@example.com', password: 'not-the-password' },
    });
    expect(r.statusCode).toBe(401);
    const audit = await env.sql`
      SELECT action, meta FROM audit_log WHERE action = 'auth.login.failed' ORDER BY at DESC LIMIT 1
    `;
    expect(audit.length).toBe(1);
    expect(audit[0]!.action).toBe('auth.login.failed');
  });

  it('login → me → logout end-to-end', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'matt@example.com', password: 'correct-horse-battery-staple' },
    });
    expect(login.statusCode).toBe(200);
    const token = readSetCookie(login.headers['set-cookie']);
    expect(token).toBeTruthy();

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('matt@example.com');

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(logout.statusCode).toBe(200);

    // After logout the session is revoked.
    const meAfter = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(meAfter.statusCode).toBe(401);
  });

  it('rejects unauthenticated /auth/me', async () => {
    const r = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(r.statusCode).toBe(401);
  });

  it('password-reset request always returns ok and never reveals user existence', async () => {
    const a = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'matt@example.com' },
    });
    const b = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'nobody@example.com' },
    });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json()).toEqual({ ok: true });
    expect(b.json()).toEqual({ ok: true });
  });

  it('TOTP enroll → confirm → required at next login', async () => {
    // Need a fresh user to avoid coupling with other tests.
    await createUser(env.db, {
      email: 'mfa@example.com',
      password: 'correct-horse-battery-staple',
    });
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'mfa@example.com', password: 'correct-horse-battery-staple' },
    });
    const token = readSetCookie(login.headers['set-cookie']);
    const cookie = `${SESSION_COOKIE}=${token}`;

    const enroll = await app.inject({
      method: 'POST',
      url: '/auth/totp/enroll',
      headers: { cookie },
    });
    expect(enroll.statusCode).toBe(200);
    const { secret } = enroll.json();
    const code = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
      digits: 6,
      period: 30,
      algorithm: 'SHA1',
    }).generate();

    const confirm = await app.inject({
      method: 'POST',
      url: '/auth/totp/confirm',
      headers: { cookie },
      payload: { code },
    });
    expect(confirm.statusCode).toBe(200);

    // Now login without TOTP fails with totp_required.
    const reLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'mfa@example.com', password: 'correct-horse-battery-staple' },
    });
    expect(reLogin.statusCode).toBe(401);
    expect(reLogin.json().error).toBe('totp_required');

    // Login with a fresh TOTP succeeds.
    const code2 = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
      digits: 6,
      period: 30,
      algorithm: 'SHA1',
    }).generate();
    const reLoginOk = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'mfa@example.com',
        password: 'correct-horse-battery-staple',
        totp: code2,
      },
    });
    expect(reLoginOk.statusCode).toBe(200);
  });
});
