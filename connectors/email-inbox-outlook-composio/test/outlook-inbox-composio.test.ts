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

function ctx(overrides: Partial<{ userId: string }> = {}) {
  const parsed = manifest.settingsSchema.parse({});
  return {
    credentials: {
      kind: 'api-key' as const,
      key: 'composio-key',
      extra: { userId: overrides.userId ?? 'cm-admin' },
    },
    settings: parsed,
    logger: noopLogger,
  };
}

describe('connector-email-inbox-outlook-composio', () => {
  beforeEach(() => executeTool.mockReset());

  it('manifest declares email-inbox capability + outlook toolkit', () => {
    expect(manifest.slug).toBe('email-inbox-outlook-composio');
    expect(manifest.capability).toBe('email-inbox');
    expect(manifest.authKind).toBe('api-key');
    expect(manifest.externalOAuth).toEqual({ provider: 'composio', toolkit: 'outlook' });
  });

  it('factory rejects credentials without extra.userId', () => {
    const c = ctx();
    (c as { credentials: unknown }).credentials = { kind: 'api-key', key: 'k' };
    expect(() => connector.factory(c as never)).toThrow(/userId/);
  });

  it('listMessages builds OData filter, maps Outlook payload, surfaces @odata.nextLink', async () => {
    executeTool.mockResolvedValueOnce({
      successful: true,
      data: {
        value: [
          {
            id: 'AAA',
            conversationId: 'CONV1',
            subject: 'Hi',
            bodyPreview: 'a preview',
            from: { emailAddress: { address: 'a@b.com' } },
            toRecipients: [{ emailAddress: { address: 'me@x.com' } }],
            receivedDateTime: '2026-06-01T12:00:00Z',
            isRead: false,
            categories: ['Customer'],
          },
        ],
        '@odata.nextLink': 'https://graph.microsoft.com/...skip=50',
      },
    });
    const inbox = connector.factory(ctx());
    const out = await inbox.listMessages({
      since: new Date(Date.UTC(2026, 5, 1)),
      until: new Date(Date.UTC(2026, 5, 30)),
      unreadOnly: true,
      labelId: 'Inbox',
      pageSize: 25,
    });
    const call = executeTool.mock.calls[0]![0];
    expect(call.toolSlug).toBe('OUTLOOK_LIST_MESSAGES');
    expect(call.arguments.top).toBe(25);
    expect(call.arguments.filter).toBe(
      'isRead eq false and receivedDateTime ge 2026-06-01T00:00:00.000Z and receivedDateTime le 2026-06-30T00:00:00.000Z',
    );
    expect(call.arguments.folder_id).toBe('Inbox');
    expect(out.nextCursor).toContain('skip=50');
    expect(out.messages[0]!.unread).toBe(true);
    expect(out.messages[0]!.from).toBe('a@b.com');
    expect(out.messages[0]!.labels).toEqual(['Customer']);
  });

  it('listMessages forwards cursor as next_link and clamps page size', async () => {
    executeTool.mockResolvedValueOnce({ successful: true, data: { value: [] } });
    const inbox = connector.factory(ctx());
    await inbox.listMessages({ cursor: 'NEXTLINK', pageSize: 5000 });
    const args = executeTool.mock.calls[0]![0].arguments;
    expect(args.next_link).toBe('NEXTLINK');
    expect(args.top).toBe(200);
  });

  it('getMessage routes to OUTLOOK_GET_MESSAGE and maps html body', async () => {
    executeTool.mockResolvedValueOnce({
      successful: true,
      data: {
        id: 'M1',
        subject: 'S',
        from: { emailAddress: { address: 'a@b.com' } },
        toRecipients: [{ emailAddress: { address: 'me@x.com' } }],
        body: { contentType: 'html', content: '<p>hello</p>' },
      },
    });
    const inbox = connector.factory(ctx());
    const out = await inbox.getMessage('M1');
    expect(executeTool).toHaveBeenCalledWith({
      toolSlug: 'OUTLOOK_GET_MESSAGE',
      userId: 'cm-admin',
      arguments: { message_id: 'M1' },
    });
    expect(out.html).toBe('<p>hello</p>');
    expect(out.text).toBe('');
  });

  it('markRead / markUnread call OUTLOOK_UPDATE_MESSAGE with is_read', async () => {
    executeTool.mockResolvedValue({ successful: true, data: {} });
    const inbox = connector.factory(ctx());
    await inbox.markRead(['M1']);
    expect(executeTool.mock.calls[0]![0]).toEqual({
      toolSlug: 'OUTLOOK_UPDATE_MESSAGE',
      userId: 'cm-admin',
      arguments: { message_id: 'M1', is_read: true },
    });
    await inbox.markUnread(['M2']);
    expect(executeTool.mock.calls[1]![0].arguments).toEqual({
      message_id: 'M2',
      is_read: false,
    });
  });

  it('archive moves to the configured Archive folder', async () => {
    executeTool.mockResolvedValue({ successful: true, data: {} });
    const inbox = connector.factory(ctx());
    await inbox.archive(['M1']);
    expect(executeTool.mock.calls[0]![0]).toEqual({
      toolSlug: 'OUTLOOK_MOVE_MESSAGE',
      userId: 'cm-admin',
      arguments: { message_id: 'M1', destination_id: 'Archive' },
    });
  });

  it('trash moves to DeletedItems', async () => {
    executeTool.mockResolvedValue({ successful: true, data: {} });
    const inbox = connector.factory(ctx());
    await inbox.trash(['M1']);
    expect(executeTool.mock.calls[0]![0].arguments).toEqual({
      message_id: 'M1',
      destination_id: 'DeletedItems',
    });
  });

  it('deletePermanently calls OUTLOOK_DELETE_MESSAGE per id', async () => {
    executeTool.mockResolvedValue({ successful: true, data: {} });
    const inbox = connector.factory(ctx());
    await inbox.deletePermanently(['M1', 'M2']);
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(executeTool.mock.calls[0]![0].toolSlug).toBe('OUTLOOK_DELETE_MESSAGE');
  });

  it('addLabels writes categories via OUTLOOK_UPDATE_MESSAGE', async () => {
    executeTool.mockResolvedValue({ successful: true, data: {} });
    const inbox = connector.factory(ctx());
    await inbox.addLabels!(['M1'], ['Customer', 'Lead']);
    expect(executeTool.mock.calls[0]![0].arguments).toEqual({
      message_id: 'M1',
      categories: ['Customer', 'Lead'],
    });
  });

  it('removeLabels does read-modify-write on categories', async () => {
    executeTool.mockResolvedValueOnce({
      successful: true,
      data: { id: 'M1', categories: ['Customer', 'Lead', 'Vendor'] },
    });
    executeTool.mockResolvedValueOnce({ successful: true, data: {} });
    const inbox = connector.factory(ctx());
    await inbox.removeLabels!(['M1'], ['Lead']);
    expect(executeTool.mock.calls[0]![0].toolSlug).toBe('OUTLOOK_GET_MESSAGE');
    expect(executeTool.mock.calls[1]![0]).toEqual({
      toolSlug: 'OUTLOOK_UPDATE_MESSAGE',
      userId: 'cm-admin',
      arguments: { message_id: 'M1', categories: ['Customer', 'Vendor'] },
    });
  });

  it('listLabels maps Outlook master categories', async () => {
    executeTool.mockResolvedValueOnce({
      successful: true,
      data: {
        value: [
          { id: 'cat-1', displayName: 'Customer' },
          { id: 'cat-2', displayName: 'Lead' },
        ],
      },
    });
    const inbox = connector.factory(ctx());
    const out = await inbox.listLabels!();
    expect(out).toEqual([
      { id: 'cat-1', name: 'Customer', isUserDefined: true },
      { id: 'cat-2', name: 'Lead', isUserDefined: true },
    ]);
    expect(executeTool).toHaveBeenCalledWith({
      toolSlug: 'OUTLOOK_LIST_CATEGORIES',
      userId: 'cm-admin',
      arguments: {},
    });
  });

  it('search passes query through as $search param', async () => {
    executeTool.mockResolvedValueOnce({ successful: true, data: { value: [] } });
    const inbox = connector.factory(ctx());
    await inbox.search('from:foo@bar.com', { pageSize: 10 });
    expect(executeTool.mock.calls[0]![0]).toEqual({
      toolSlug: 'OUTLOOK_LIST_MESSAGES',
      userId: 'cm-admin',
      arguments: { top: 10, search: 'from:foo@bar.com' },
    });
  });

  it('throws on !successful', async () => {
    executeTool.mockResolvedValueOnce({ successful: false, error: 'oops' });
    const inbox = connector.factory(ctx());
    await expect(inbox.listMessages({})).rejects.toThrow(/oops/);
  });
});
