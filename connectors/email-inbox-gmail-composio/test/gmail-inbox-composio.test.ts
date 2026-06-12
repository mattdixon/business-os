import { describe, it, expect, vi, beforeEach } from 'vitest';

const { executeTool } = vi.hoisted(() => ({ executeTool: vi.fn() }));

vi.mock('@frontrangesystems/business-os-connector-composio', async () => {
  const actual = await vi.importActual<typeof import('@frontrangesystems/business-os-connector-composio')>(
    '@frontrangesystems/business-os-connector-composio',
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

describe('connector-email-inbox-gmail-composio', () => {
  beforeEach(() => executeTool.mockReset());

  it('manifest declares email-inbox capability + api-key auth + composio toolkit', () => {
    expect(manifest.slug).toBe('email-inbox-gmail-composio');
    expect(manifest.capability).toBe('email-inbox');
    expect(manifest.authKind).toBe('api-key');
    expect(manifest.externalOAuth).toEqual({ provider: 'composio', toolkit: 'gmail' });
  });

  it('factory rejects credentials without extra.userId', () => {
    const c = ctx();
    (c as { credentials: unknown }).credentials = { kind: 'api-key', key: 'k' };
    expect(() => connector.factory(c as never)).toThrow(/userId/);
  });

  it('listMessages builds Gmail query from opts and surfaces nextPageToken as nextCursor', async () => {
    executeTool.mockResolvedValueOnce({
      successful: true,
      data: {
        messages: [
          {
            id: 'm1',
            threadId: 't1',
            subject: 'Hi',
            sender: 'a@b.com',
            to: 'me@x.com',
            messageText: 'body',
            messageTimestamp: '2026-06-01T12:00:00Z',
            labelIds: ['INBOX', 'UNREAD'],
          },
        ],
        nextPageToken: 'pg2',
      },
    });
    const inbox = connector.factory(ctx());
    const out = await inbox.listMessages({
      since: new Date(Date.UTC(2026, 5, 1)),
      until: new Date(Date.UTC(2026, 5, 30)),
      unreadOnly: true,
      labelId: 'Promotions',
      pageSize: 25,
    });
    expect(executeTool).toHaveBeenCalledWith({
      toolSlug: 'GMAIL_FETCH_EMAILS',
      userId: 'cm-admin',
      arguments: {
        max_results: 25,
        query: 'is:unread after:2026/06/01 before:2026/06/30 label:Promotions',
      },
    });
    expect(out.nextCursor).toBe('pg2');
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]!.unread).toBe(true);
    expect(out.messages[0]!.labels).toEqual(['INBOX', 'UNREAD']);
  });

  it('listMessages passes through cursor as page_token and clamps page size', async () => {
    executeTool.mockResolvedValueOnce({ successful: true, data: { messages: [] } });
    const inbox = connector.factory(ctx());
    await inbox.listMessages({ cursor: 'abc', pageSize: 5000 });
    const args = executeTool.mock.calls[0]![0].arguments;
    expect(args.page_token).toBe('abc');
    // MAX_PAGE_SIZE is 50 — Composio's GMAIL_FETCH_EMAILS upstream chokes on
    // bigger payloads. Clamps anything larger.
    expect(args.max_results).toBe(50);
    expect(args.query).toBeUndefined();
  });

  it('listMessages returns null nextCursor when none', async () => {
    executeTool.mockResolvedValueOnce({ successful: true, data: { messages: [] } });
    const inbox = connector.factory(ctx());
    const out = await inbox.listMessages({});
    expect(out.nextCursor).toBeNull();
  });

  it('getMessage routes to GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID and returns full body', async () => {
    executeTool.mockResolvedValueOnce({
      successful: true,
      data: {
        // Composio surfaces the Gmail id under `messageId`, not top-level `id`.
        messageId: 'm3',
        threadId: 't3',
        subject: 'S',
        sender: 'a@b.com',
        to: 'me@x.com',
        payload: {
          headers: [
            { name: 'From', value: 'a@b.com' },
            { name: 'Subject', value: 'S' },
          ],
          parts: [
            { mimeType: 'text/plain', body: { data: Buffer.from('plain').toString('base64url') } },
            {
              mimeType: 'text/html',
              body: { data: Buffer.from('<b>html</b>').toString('base64url') },
            },
          ],
        },
        labelIds: ['INBOX'],
      },
    });
    const inbox = connector.factory(ctx());
    const out = await inbox.getMessage('m3');
    expect(executeTool).toHaveBeenCalledWith({
      toolSlug: 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID',
      userId: 'cm-admin',
      arguments: { message_id: 'm3', format: 'full' },
    });
    expect(out.id).toBe('m3');
    expect(out.text).toBe('plain');
    expect(out.html).toBe('<b>html</b>');
    expect(out.headers?.From).toBe('a@b.com');
  });

  it('markRead removes UNREAD label via GMAIL_MODIFY_LABELS for each id', async () => {
    executeTool.mockResolvedValue({ successful: true, data: {} });
    const inbox = connector.factory(ctx());
    await inbox.markRead(['m1', 'm2']);
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(executeTool.mock.calls[0]![0]).toEqual({
      toolSlug: 'GMAIL_MODIFY_LABELS',
      userId: 'cm-admin',
      arguments: { message_id: 'm1', add_label_ids: [], remove_label_ids: ['UNREAD'] },
    });
    expect(executeTool.mock.calls[1]![0].arguments.message_id).toBe('m2');
  });

  it('markUnread adds UNREAD label', async () => {
    executeTool.mockResolvedValue({ successful: true, data: {} });
    const inbox = connector.factory(ctx());
    await inbox.markUnread(['m1']);
    expect(executeTool.mock.calls[0]![0].arguments).toEqual({
      message_id: 'm1',
      add_label_ids: ['UNREAD'],
      remove_label_ids: [],
    });
  });

  it('archive removes INBOX label', async () => {
    executeTool.mockResolvedValue({ successful: true, data: {} });
    const inbox = connector.factory(ctx());
    await inbox.archive(['m1']);
    expect(executeTool.mock.calls[0]![0].arguments).toEqual({
      message_id: 'm1',
      add_label_ids: [],
      remove_label_ids: ['INBOX'],
    });
  });

  it('trash adds TRASH and removes INBOX', async () => {
    executeTool.mockResolvedValue({ successful: true, data: {} });
    const inbox = connector.factory(ctx());
    await inbox.trash(['m1']);
    expect(executeTool.mock.calls[0]![0].arguments).toEqual({
      message_id: 'm1',
      add_label_ids: ['TRASH'],
      remove_label_ids: ['INBOX'],
    });
  });

  it('deletePermanently calls GMAIL_DELETE_MESSAGE', async () => {
    executeTool.mockResolvedValue({ successful: true, data: {} });
    const inbox = connector.factory(ctx());
    await inbox.deletePermanently(['m1', 'm2']);
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(executeTool.mock.calls[0]![0]).toEqual({
      toolSlug: 'GMAIL_DELETE_MESSAGE',
      userId: 'cm-admin',
      arguments: { message_id: 'm1' },
    });
  });

  it('addLabels and removeLabels go through GMAIL_MODIFY_LABELS', async () => {
    executeTool.mockResolvedValue({ successful: true, data: {} });
    const inbox = connector.factory(ctx());
    await inbox.addLabels!(['m1'], ['Customer']);
    expect(executeTool.mock.calls[0]![0].arguments).toEqual({
      message_id: 'm1',
      add_label_ids: ['Customer'],
      remove_label_ids: [],
    });
    await inbox.removeLabels!(['m1'], ['Customer']);
    expect(executeTool.mock.calls[1]![0].arguments).toEqual({
      message_id: 'm1',
      add_label_ids: [],
      remove_label_ids: ['Customer'],
    });
  });

  it('listLabels maps system vs user type', async () => {
    executeTool.mockResolvedValueOnce({
      successful: true,
      data: {
        labels: [
          { id: 'INBOX', name: 'INBOX', type: 'system' },
          { id: 'Label_1', name: 'Customer', type: 'user' },
        ],
      },
    });
    const inbox = connector.factory(ctx());
    const out = await inbox.listLabels!();
    expect(out).toEqual([
      { id: 'INBOX', name: 'INBOX', isUserDefined: false },
      { id: 'Label_1', name: 'Customer', isUserDefined: true },
    ]);
    expect(executeTool).toHaveBeenCalledWith({
      toolSlug: 'GMAIL_LIST_LABELS',
      userId: 'cm-admin',
      arguments: {},
    });
  });

  it('search passes query verbatim to GMAIL_FETCH_EMAILS', async () => {
    executeTool.mockResolvedValueOnce({
      successful: true,
      data: { messages: [], nextPageToken: 'np' },
    });
    const inbox = connector.factory(ctx());
    const out = await inbox.search('from:foo is:unread', { pageSize: 10, cursor: 'cur' });
    expect(executeTool).toHaveBeenCalledWith({
      toolSlug: 'GMAIL_FETCH_EMAILS',
      userId: 'cm-admin',
      arguments: { max_results: 10, query: 'from:foo is:unread', page_token: 'cur' },
    });
    expect(out.nextCursor).toBe('np');
  });

  it('throws on !successful results', async () => {
    executeTool.mockResolvedValueOnce({ successful: false, error: 'rate-limited' });
    const inbox = connector.factory(ctx());
    await expect(inbox.listMessages({})).rejects.toThrow(/rate-limited/);
  });
});
