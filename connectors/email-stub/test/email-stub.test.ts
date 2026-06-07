import { describe, it, expect } from 'vitest';
import connector, { manifest } from '../src/index.js';

const noopLogger = {
  info: (_o: object | string, _m?: string) => {},
  warn: (_o: object | string, _m?: string) => {},
  error: (_o: object | string, _m?: string) => {},
};

function buildCtx(seed: unknown = []): {
  credentials: { kind: 'none' };
  settings: ReturnType<typeof manifest.settingsSchema.parse>;
  logger: typeof noopLogger;
} {
  return {
    credentials: { kind: 'none' },
    settings: manifest.settingsSchema.parse({ seedInbox: seed }),
    logger: noopLogger,
  };
}

describe('connector-email-stub', () => {
  it('manifest declares email capability + none auth', () => {
    expect(manifest.slug).toBe('email-stub');
    expect(manifest.capability).toBe('email');
    expect(manifest.authKind).toBe('none');
  });

  it('send() returns a stub messageId without dispatching anything', async () => {
    const email = connector.factory(buildCtx() as never);
    const r = await email.send({ to: 'sam@example.com', subject: 'hi', text: 'body' });
    expect(r.messageId).toMatch(/^stub-/);
  });

  it('listInbox() returns the seeded inbox', async () => {
    const email = connector.factory(
      buildCtx([
        {
          from: 'lead@acme.com',
          to: ['ops@cnn.example'],
          subject: 'Inquiry',
          text: 'Hi, interested in services.',
        },
      ]) as never,
    );
    const inbox = await email.listInbox!({});
    expect(inbox.length).toBe(1);
    expect(inbox[0]!.from).toBe('lead@acme.com');
    expect(inbox[0]!.subject).toBe('Inquiry');
  });

  it('listInbox() defaults to empty', async () => {
    const email = connector.factory(buildCtx() as never);
    const inbox = await email.listInbox!({});
    expect(inbox).toEqual([]);
  });
});
