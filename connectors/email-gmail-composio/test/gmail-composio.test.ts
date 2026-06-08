import { describe, it, expect, vi, beforeEach } from 'vitest';

const { executeTool } = vi.hoisted(() => ({ executeTool: vi.fn() }));

vi.mock('@business-os/connector-composio', async () => {
  const actual = await vi.importActual<typeof import('@business-os/connector-composio')>(
    '@business-os/connector-composio',
  );
  return {
    ...actual,
    ComposioSubstrate: class {
      constructor(public opts: { apiKey: string }) {}
      executeTool = executeTool;
    },
  };
});

import connector, { manifest } from '../src/index.js';

const noopLogger = {
  info: (_o: object | string, _m?: string) => {},
  warn: (_o: object | string, _m?: string) => {},
  error: (_o: object | string, _m?: string) => {},
};

function ctx(extras: Partial<{ userId: string }> = {}) {
  const parsed = manifest.settingsSchema.parse({});
  return {
    credentials: {
      kind: 'api-key' as const,
      key: 'composio-key',
      extra: { userId: extras.userId ?? 'cm-admin' },
    },
    settings: parsed,
    logger: noopLogger,
  };
}

describe('connector-email-gmail-composio', () => {
  beforeEach(() => executeTool.mockReset());

  it('manifest declares email capability + api-key auth', () => {
    expect(manifest.slug).toBe('email-gmail-composio');
    expect(manifest.capability).toBe('email');
    expect(manifest.authKind).toBe('api-key');
  });

  it('factory rejects credentials without extra.userId', () => {
    const c = ctx();
    (c as { credentials: unknown }).credentials = { kind: 'api-key', key: 'k' };
    expect(() => connector.factory(c as never)).toThrow(/userId/);
  });

  it('send() calls GMAIL_SEND_EMAIL with recipient/subject/body', async () => {
    executeTool.mockResolvedValueOnce({ successful: true, data: { id: 'msg_1' } });
    const email = connector.factory(ctx());
    const r = await email.send({ to: 'a@b.com', subject: 's', text: 'hi' });
    expect(r).toEqual({ messageId: 'msg_1' });
    expect(executeTool).toHaveBeenCalledWith({
      toolSlug: 'GMAIL_SEND_EMAIL',
      userId: 'cm-admin',
      arguments: { recipient_email: 'a@b.com', subject: 's', body: 'hi', is_html: false },
    });
  });

  it('send() joins to[] and prefers html when present', async () => {
    executeTool.mockResolvedValueOnce({ successful: true, data: { id: 'msg_2' } });
    const email = connector.factory(ctx());
    await email.send({
      to: ['a@b.com', 'c@d.com'],
      subject: 's',
      text: 'plain',
      html: '<p>rich</p>',
    });
    const args = executeTool.mock.calls[0]![0].arguments;
    expect(args.recipient_email).toBe('a@b.com, c@d.com');
    expect(args.body).toBe('<p>rich</p>');
    expect(args.is_html).toBe(true);
  });

  it('send() throws when underlying tool reports !successful', async () => {
    executeTool.mockResolvedValueOnce({ successful: false, error: 'quota' });
    const email = connector.factory(ctx());
    await expect(email.send({ to: 'a@b.com', subject: 's', text: 'x' })).rejects.toThrow(/quota/);
  });

  it('listInbox builds gmail query from opts', async () => {
    executeTool.mockResolvedValueOnce({ successful: true, data: { messages: [] } });
    const email = connector.factory(ctx());
    await email.listInbox!({
      since: new Date(Date.UTC(2026, 5, 1)), // June is month 5 (0-indexed)
      unreadOnly: true,
      limit: 10,
    });
    const args = executeTool.mock.calls[0]![0].arguments;
    expect(args.max_results).toBe(10);
    expect(args.query).toBe('is:unread after:2026/06/01');
  });

  it('listInbox maps GmailMessage shape into InboundEmail', async () => {
    executeTool.mockResolvedValueOnce({
      successful: true,
      data: {
        messages: [
          {
            id: 'm1',
            threadId: 't1',
            subject: 'Hello',
            sender: 'a@b.com',
            to: 'me@x.com, other@x.com',
            messageText: 'body text',
            messageTimestamp: '2026-06-01T12:00:00Z',
          },
        ],
      },
    });
    const email = connector.factory(ctx());
    const out = await email.listInbox!({});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'm1',
      threadId: 't1',
      subject: 'Hello',
      from: 'a@b.com',
      to: ['me@x.com', 'other@x.com'],
      text: 'body text',
    });
    expect(out[0]!.receivedAt.toISOString()).toBe('2026-06-01T12:00:00.000Z');
  });

  it('listInbox falls back to payload.headers when top-level fields are missing', async () => {
    executeTool.mockResolvedValueOnce({
      successful: true,
      data: {
        messages: [
          {
            id: 'm2',
            payload: {
              headers: [
                { name: 'From', value: 'h@x.com' },
                { name: 'Subject', value: 'Header-only' },
                { name: 'To', value: 'me@x.com' },
              ],
              parts: [
                { mimeType: 'text/plain', body: { data: Buffer.from('plain').toString('base64url') } },
                { mimeType: 'text/html', body: { data: Buffer.from('<b>html</b>').toString('base64url') } },
              ],
            },
          },
        ],
      },
    });
    const email = connector.factory(ctx());
    const out = await email.listInbox!({});
    expect(out[0]).toMatchObject({
      from: 'h@x.com',
      subject: 'Header-only',
      to: ['me@x.com'],
      text: 'plain',
      html: '<b>html</b>',
    });
  });

  it('getMessage routes to GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID', async () => {
    executeTool.mockResolvedValueOnce({
      successful: true,
      data: { id: 'm3', threadId: 't3', subject: 'S', sender: 'a@b.com' },
    });
    const email = connector.factory(ctx());
    const out = await email.getMessage!('m3');
    expect(out.id).toBe('m3');
    expect(executeTool).toHaveBeenCalledWith({
      toolSlug: 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID',
      userId: 'cm-admin',
      arguments: { message_id: 'm3', format: 'full' },
    });
  });
});
