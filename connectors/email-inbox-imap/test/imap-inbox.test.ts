import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  connect,
  logout,
  getMailboxLock,
  search,
  fetchOne,
  messageFlagsAdd,
  messageFlagsRemove,
  messageMove,
  messageDelete,
  fetchIter,
  release,
} = vi.hoisted(() => ({
  connect: vi.fn(),
  logout: vi.fn(),
  getMailboxLock: vi.fn(),
  search: vi.fn(),
  fetchOne: vi.fn(),
  messageFlagsAdd: vi.fn(),
  messageFlagsRemove: vi.fn(),
  messageMove: vi.fn(),
  messageDelete: vi.fn(),
  fetchIter: vi.fn(),
  release: vi.fn(),
}));

vi.mock('imapflow', () => ({
  ImapFlow: class {
    constructor(public opts: unknown) {}
    connect = connect;
    logout = logout;
    getMailboxLock = (...args: unknown[]) =>
      getMailboxLock(...args).then(() => ({ release }));
    search = search;
    fetchOne = fetchOne;
    messageFlagsAdd = messageFlagsAdd;
    messageFlagsRemove = messageFlagsRemove;
    messageMove = messageMove;
    messageDelete = messageDelete;
    fetch = (...args: unknown[]) => fetchIter(...args);
  },
}));

import connector, { manifest } from '../src/index.js';

const noopLogger = {
  info: (_o: object | string, _m?: string) => {},
  warn: (_o: object | string, _m?: string) => {},
  error: (_o: object | string, _m?: string) => {},
};

function ctx() {
  const parsed = manifest.settingsSchema.parse({
    host: 'imap.example.com',
  });
  return {
    credentials: {
      kind: 'custom' as const,
      values: { user: 'matt@example.com', password: 'hunter2' },
    },
    settings: parsed,
    logger: noopLogger,
  };
}

function asyncIter<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const i of items) yield i;
    },
  };
}

beforeEach(() => {
  connect.mockReset();
  logout.mockReset();
  getMailboxLock.mockReset();
  search.mockReset();
  fetchOne.mockReset();
  messageFlagsAdd.mockReset();
  messageFlagsRemove.mockReset();
  messageMove.mockReset();
  messageDelete.mockReset();
  fetchIter.mockReset();
  release.mockReset();
  connect.mockResolvedValue(undefined);
  logout.mockResolvedValue(undefined);
  getMailboxLock.mockResolvedValue(undefined);
});

describe('connector-email-inbox-imap', () => {
  it('manifest declares email-inbox capability + custom auth + credentialsSchema + no externalOAuth', () => {
    expect(manifest.slug).toBe('email-inbox-imap');
    expect(manifest.capability).toBe('email-inbox');
    expect(manifest.authKind).toBe('custom');
    expect(manifest.credentialsSchema).toBeDefined();
    expect((manifest as { externalOAuth?: unknown }).externalOAuth).toBeUndefined();
  });

  it('rejects api-key credentials (custom kind required)', async () => {
    const c = ctx();
    (c as { credentials: unknown }).credentials = { kind: 'api-key', key: 'hunter2' };
    const inbox = connector.factory(c as never);
    await expect(inbox.listMessages({})).rejects.toThrow(/requires custom credentials/);
  });

  it('listMessages searches INBOX, maps envelope, returns nextCursor', async () => {
    search.mockResolvedValueOnce([3, 1, 2]); // returns out of order
    fetchIter.mockReturnValueOnce(
      asyncIter([
        {
          uid: 3,
          envelope: {
            date: '2026-06-03T00:00:00Z',
            subject: 'three',
            from: [{ address: 'a@b.com' }],
            to: [{ address: 'me@x.com' }],
            messageId: 'mid-3',
          },
          flags: new Set(['\\Seen']),
        },
      ]),
    );
    const inbox = connector.factory(ctx());
    const out = await inbox.listMessages({ pageSize: 1 });
    expect(connect).toHaveBeenCalled();
    expect(getMailboxLock).toHaveBeenCalledWith('INBOX');
    expect(search).toHaveBeenCalledWith({}, { uid: true });
    expect(out.messages[0]).toMatchObject({
      id: '3',
      from: 'a@b.com',
      subject: 'three',
      unread: false,
    });
    // 3 results, page size 1 → hasMore, lastUid in page = 3
    expect(out.nextCursor).toBe('lastUid:3');
    expect(logout).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it('listMessages forwards since/until/unreadOnly/cursor to SEARCH', async () => {
    search.mockResolvedValueOnce([]);
    const inbox = connector.factory(ctx());
    await inbox.listMessages({
      since: new Date('2026-06-01T00:00:00Z'),
      until: new Date('2026-06-30T00:00:00Z'),
      unreadOnly: true,
      cursor: 'lastUid:100',
    });
    expect(search).toHaveBeenCalledWith(
      {
        seen: false,
        since: new Date('2026-06-01T00:00:00Z'),
        before: new Date('2026-06-30T00:00:00Z'),
        uid: '1:99',
      },
      { uid: true },
    );
  });

  it('listMessages uses labelId as folder name', async () => {
    search.mockResolvedValueOnce([]);
    const inbox = connector.factory(ctx());
    await inbox.listMessages({ labelId: 'Sent' });
    expect(getMailboxLock).toHaveBeenCalledWith('Sent');
  });

  it('getMessage fetches text + html body parts by UID', async () => {
    fetchOne.mockResolvedValueOnce({
      uid: 42,
      envelope: {
        date: '2026-06-01T00:00:00Z',
        subject: 'hello',
        from: [{ address: 'a@b.com' }],
        to: [{ address: 'me@x.com' }],
      },
      flags: new Set([]),
      bodyParts: new Map<string, Buffer>([
        ['text', Buffer.from('plain body')],
        ['html', Buffer.from('<p>html body</p>')],
      ]),
    });
    const inbox = connector.factory(ctx());
    const msg = await inbox.getMessage('42');
    expect(fetchOne).toHaveBeenCalledWith(
      '42',
      { uid: true, envelope: true, flags: true, bodyParts: ['text', 'html'] },
      { uid: true },
    );
    expect(msg.text).toBe('plain body');
    expect(msg.html).toBe('<p>html body</p>');
    expect(msg.unread).toBe(true);
  });

  it('markRead adds \\Seen by UID', async () => {
    const inbox = connector.factory(ctx());
    await inbox.markRead(['1', '2']);
    expect(messageFlagsAdd).toHaveBeenCalledWith([1, 2], ['\\Seen'], { uid: true });
  });

  it('markUnread removes \\Seen by UID', async () => {
    const inbox = connector.factory(ctx());
    await inbox.markUnread(['1']);
    expect(messageFlagsRemove).toHaveBeenCalledWith([1], ['\\Seen'], { uid: true });
  });

  it('archive moves to settings.archiveFolder', async () => {
    const inbox = connector.factory(ctx());
    await inbox.archive(['1', '2']);
    expect(messageMove).toHaveBeenCalledWith([1, 2], 'Archive', { uid: true });
  });

  it('trash moves to settings.trashFolder', async () => {
    const inbox = connector.factory(ctx());
    await inbox.trash(['1']);
    expect(messageMove).toHaveBeenCalledWith([1], 'Trash', { uid: true });
  });

  it('deletePermanently opens trash folder and deletes by UID', async () => {
    const inbox = connector.factory(ctx());
    await inbox.deletePermanently(['1']);
    expect(getMailboxLock).toHaveBeenCalledWith('Trash');
    expect(messageDelete).toHaveBeenCalledWith([1], { uid: true });
  });

  it('addLabels / removeLabels / listLabels throw with the labels-not-supported message', async () => {
    const inbox = connector.factory(ctx());
    await expect(inbox.addLabels!(['1'], ['x'])).rejects.toThrow(/IMAP does not support labels/);
    await expect(inbox.removeLabels!(['1'], ['x'])).rejects.toThrow(
      /IMAP does not support labels/,
    );
    await expect(inbox.listLabels!()).rejects.toThrow(/IMAP does not support labels/);
  });

  it('search passes query to SEARCH body criterion', async () => {
    search.mockResolvedValueOnce([5, 4]);
    fetchIter.mockReturnValueOnce(
      asyncIter([
        {
          uid: 5,
          envelope: { subject: 'q-match', from: [{ address: 'a@b.com' }], to: [] },
          flags: new Set([]),
        },
        {
          uid: 4,
          envelope: { subject: 'q-match', from: [{ address: 'a@b.com' }], to: [] },
          flags: new Set([]),
        },
      ]),
    );
    const inbox = connector.factory(ctx());
    const out = await inbox.search('invoice', { pageSize: 50 });
    expect(search).toHaveBeenCalledWith({ body: 'invoice' }, { uid: true });
    expect(out.messages).toHaveLength(2);
    expect(out.nextCursor).toBeNull();
  });

  it('rejects credentials that are not custom when an operation is invoked', async () => {
    const c = ctx();
    (c as { credentials: unknown }).credentials = { kind: 'oauth2', accessToken: 'x' };
    const inbox = connector.factory(c as never);
    await expect(inbox.markRead(['1'])).rejects.toThrow(/requires custom credentials/);
  });
});
