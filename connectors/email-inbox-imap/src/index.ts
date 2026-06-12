import { z } from 'zod';
import { ImapFlow } from 'imapflow';
import {
  defineConnector,
  type ConnectorContext,
  type EmailInboxCapability,
  type InboxLabel,
  type InboxMessage,
  type InboxMessageSummary,
  type ListMessagesOpts,
  type ListMessagesResult,
  type SearchOpts,
} from '@frontrangesystems/business-os-connector-sdk';

/**
 * Direct IMAP provider for the `email-inbox` capability.
 *
 * Credentials shape (kind: 'custom'):
 *   values.user:     <imap username, e.g. matt@example.com>
 *   values.password: <imap password / app-specific password>
 *
 * Settings carry the connection target — host/port/folders — which the
 * operator fills in alongside credentials in the Add form.
 *
 * We open a fresh connection per call rather than holding a long-lived one,
 * because long-lived sockets are fragile in serverless / restart contexts and
 * IMAP servers commonly idle-time clients out anyway.
 */

const settingsSchema = z.object({
  host: z.string().describe('IMAP server hostname, e.g. imap.fastmail.com'),
  port: z.number().int().default(993),
  secure: z.boolean().default(true).describe('Use TLS (port 993). Disable only for plaintext IMAP on 143.'),
  /** Folder for archive moves. */
  archiveFolder: z.string().default('Archive'),
  /** Folder for trash moves. */
  trashFolder: z.string().default('Trash'),
  /** Default page size when caller omits one. */
  defaultPageSize: z.number().int().min(1).max(200).default(50),
});

const credentialsSchema = z.object({
  user: z.string().describe('IMAP username (usually your email address)'),
  password: z.string().describe('secret: IMAP password or app-specific password'),
});

type Settings = z.infer<typeof settingsSchema>;
type Creds = z.infer<typeof credentialsSchema>;

const MAX_PAGE_SIZE = 200;
const SNIPPET_LEN = 200;

function readCreds(ctx: ConnectorContext<Settings>): Creds {
  if (ctx.credentials.kind !== 'custom') {
    throw new Error(
      `connector-email-inbox-imap requires custom credentials, got "${ctx.credentials.kind}"`,
    );
  }
  return credentialsSchema.parse(ctx.credentials.values);
}

function makeClient(ctx: ConnectorContext<Settings>): ImapFlow {
  const { user, password } = readCreds(ctx);
  const { host, port, secure } = ctx.settings;
  return new ImapFlow({
    host,
    port,
    secure,
    auth: { user, pass: password },
    logger: false,
  });
}

async function withClient<T>(
  ctx: ConnectorContext<Settings>,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = makeClient(ctx);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore logout errors — connection may already be dead
    }
  }
}

// -----------------------------------------------------------------------------
// Envelope / fetch result shaping
// -----------------------------------------------------------------------------

interface ImapAddress {
  name?: string;
  address?: string;
}

interface ImapEnvelope {
  date?: Date | string;
  subject?: string;
  from?: ImapAddress[];
  to?: ImapAddress[];
  cc?: ImapAddress[];
  messageId?: string;
  inReplyTo?: string;
}

interface ImapFetchMessage {
  uid: number;
  envelope?: ImapEnvelope;
  flags?: Set<string> | string[];
  source?: Buffer;
  bodyParts?: Map<string, Buffer>;
}

function flagsToArray(flags: Set<string> | string[] | undefined): string[] {
  if (!flags) return [];
  return Array.isArray(flags) ? flags : Array.from(flags);
}

function isUnread(flags: Set<string> | string[] | undefined): boolean {
  const arr = flagsToArray(flags);
  return !arr.includes('\\Seen');
}

function addrToString(a: ImapAddress): string {
  return a.address ?? '';
}

function addrs(list: ImapAddress[] | undefined): string[] {
  return (list ?? []).map(addrToString).filter(Boolean);
}

function envToSummary(msg: ImapFetchMessage): InboxMessageSummary {
  const env = msg.envelope ?? {};
  const ts = env.date ? new Date(env.date) : new Date();
  return {
    id: String(msg.uid),
    threadId: env.inReplyTo ?? env.messageId ?? String(msg.uid),
    from: env.from && env.from.length > 0 ? addrToString(env.from[0]!) : '',
    to: addrs(env.to),
    cc: env.cc && env.cc.length > 0 ? addrs(env.cc) : undefined,
    subject: env.subject ?? '',
    snippet: '',
    receivedAt: ts,
    unread: isUnread(msg.flags),
    labels: flagsToArray(msg.flags),
  };
}

function parseCursor(cursor: string | undefined): number | undefined {
  if (!cursor) return undefined;
  const m = /^lastUid:(\d+)$/.exec(cursor);
  return m ? Number(m[1]) : undefined;
}

function clampPageSize(requested: number | undefined, fallback: number): number {
  const n = requested ?? fallback;
  return Math.min(Math.max(n, 1), MAX_PAGE_SIZE);
}

// -----------------------------------------------------------------------------
// Capability impl
// -----------------------------------------------------------------------------

function makeInbox(ctx: ConnectorContext<Settings>): EmailInboxCapability {
  const { archiveFolder, trashFolder, defaultPageSize } = ctx.settings;

  return {
    async listMessages(opts: ListMessagesOpts): Promise<ListMessagesResult> {
      const folder = opts.labelId ?? 'INBOX';
      const pageSize = clampPageSize(opts.pageSize, defaultPageSize);
      const beforeUid = parseCursor(opts.cursor);

      return withClient(ctx, async (client) => {
        const lock = await client.getMailboxLock(folder);
        try {
          // Find candidate UIDs via SEARCH.
          const criteria: Record<string, unknown> = {};
          if (opts.unreadOnly) criteria.seen = false;
          if (opts.since) criteria.since = opts.since;
          if (opts.until) criteria.before = opts.until;
          if (beforeUid !== undefined) criteria.uid = `1:${beforeUid - 1}`;

          const uids = (await client.search(criteria, { uid: true })) as number[] | false;
          const all = Array.isArray(uids) ? uids : [];
          // Largest UIDs first → newest first.
          all.sort((a, b) => b - a);
          const page = all.slice(0, pageSize);

          const messages: InboxMessageSummary[] = [];
          if (page.length > 0) {
            const fetched = client.fetch(page, { uid: true, envelope: true, flags: true }, {
              uid: true,
            });
            for await (const msg of fetched as AsyncIterable<ImapFetchMessage>) {
              messages.push(envToSummary(msg));
            }
          }
          messages.sort((a, b) => Number(b.id) - Number(a.id));

          const lastUid = page.length > 0 ? page[page.length - 1]! : null;
          const hasMore = all.length > page.length;
          const nextCursor = hasMore && lastUid !== null ? `lastUid:${lastUid}` : null;

          return { messages, nextCursor };
        } finally {
          lock.release();
        }
      });
    },

    async getMessage(id: string): Promise<InboxMessage> {
      const uid = Number(id);
      return withClient(ctx, async (client) => {
        const lock = await client.getMailboxLock('INBOX');
        try {
          const msg = (await client.fetchOne(
            String(uid),
            { uid: true, envelope: true, flags: true, bodyParts: ['text', 'html'] },
            { uid: true },
          )) as ImapFetchMessage | false;
          if (!msg) throw new Error(`imap: message ${id} not found`);
          const summary = envToSummary(msg);
          const textBuf = msg.bodyParts?.get('text');
          const htmlBuf = msg.bodyParts?.get('html');
          const text = textBuf ? textBuf.toString('utf8') : '';
          const html = htmlBuf ? htmlBuf.toString('utf8') : undefined;
          return {
            ...summary,
            snippet: text.slice(0, SNIPPET_LEN),
            text,
            html,
          };
        } finally {
          lock.release();
        }
      });
    },

    async markRead(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      const uids = ids.map((s) => Number(s));
      await withClient(ctx, async (client) => {
        const lock = await client.getMailboxLock('INBOX');
        try {
          await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
        } finally {
          lock.release();
        }
      });
    },

    async markUnread(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      const uids = ids.map((s) => Number(s));
      await withClient(ctx, async (client) => {
        const lock = await client.getMailboxLock('INBOX');
        try {
          await client.messageFlagsRemove(uids, ['\\Seen'], { uid: true });
        } finally {
          lock.release();
        }
      });
    },

    async archive(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      const uids = ids.map((s) => Number(s));
      await withClient(ctx, async (client) => {
        const lock = await client.getMailboxLock('INBOX');
        try {
          await client.messageMove(uids, archiveFolder, { uid: true });
        } finally {
          lock.release();
        }
      });
    },

    async trash(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      const uids = ids.map((s) => Number(s));
      await withClient(ctx, async (client) => {
        const lock = await client.getMailboxLock('INBOX');
        try {
          await client.messageMove(uids, trashFolder, { uid: true });
        } finally {
          lock.release();
        }
      });
    },

    async deletePermanently(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      const uids = ids.map((s) => Number(s));
      await withClient(ctx, async (client) => {
        // Permanent delete typically means: select the trash folder and
        // expunge the messages there. Caller is expected to have moved them
        // to trash first; if they're elsewhere, this is a no-op for those
        // ids in the trash mailbox.
        const lock = await client.getMailboxLock(trashFolder);
        try {
          await client.messageDelete(uids, { uid: true });
        } finally {
          lock.release();
        }
      });
    },

    async addLabels(_ids: string[], _labels: string[]): Promise<void> {
      throw new Error('IMAP does not support labels; use folder moves instead');
    },

    async removeLabels(_ids: string[], _labels: string[]): Promise<void> {
      throw new Error('IMAP does not support labels; use folder moves instead');
    },

    async listLabels(): Promise<InboxLabel[]> {
      throw new Error('IMAP does not support labels; use folder moves instead');
    },

    async search(query: string, opts?: SearchOpts): Promise<ListMessagesResult> {
      const pageSize = clampPageSize(opts?.pageSize, defaultPageSize);
      const beforeUid = parseCursor(opts?.cursor);

      return withClient(ctx, async (client) => {
        const lock = await client.getMailboxLock('INBOX');
        try {
          // We pass `query` through as an opaque IMAP SEARCH expression by
          // stuffing it into the `header` criterion would be wrong, so instead
          // we treat the operator's input as a single subject/text token. For
          // more flexible structured search the operator should rely on the
          // structured `listMessages` opts. This keeps the surface predictable
          // while honoring the capability contract.
          const criteria: Record<string, unknown> = { body: query };
          if (beforeUid !== undefined) criteria.uid = `1:${beforeUid - 1}`;

          const uids = (await client.search(criteria, { uid: true })) as number[] | false;
          const all = Array.isArray(uids) ? uids : [];
          all.sort((a, b) => b - a);
          const page = all.slice(0, pageSize);

          const messages: InboxMessageSummary[] = [];
          if (page.length > 0) {
            const fetched = client.fetch(page, { uid: true, envelope: true, flags: true }, {
              uid: true,
            });
            for await (const msg of fetched as AsyncIterable<ImapFetchMessage>) {
              messages.push(envToSummary(msg));
            }
          }
          messages.sort((a, b) => Number(b.id) - Number(a.id));

          const lastUid = page.length > 0 ? page[page.length - 1]! : null;
          const hasMore = all.length > page.length;
          const nextCursor = hasMore && lastUid !== null ? `lastUid:${lastUid}` : null;
          return { messages, nextCursor };
        } finally {
          lock.release();
        }
      });
    },
  };
}

export const manifest = {
  slug: 'email-inbox-imap',
  capability: 'email-inbox' as const,
  version: '0.0.1',
  displayName: 'IMAP Inbox',
  authKind: 'custom' as const,
  settingsSchema,
  credentialsSchema,
};

export default defineConnector({
  manifest,
  factory: (ctx) => makeInbox(ctx as ConnectorContext<Settings>),
  /**
   * Reachability check: connect, log out. Verifies credentials + host/port
   * without listing any messages. Surfaces the IMAP server's error message
   * (auth failure, DNS failure, TLS mismatch) directly to the operator.
   */
  async verify(ctx) {
    const client = makeClient(ctx as ConnectorContext<Settings>);
    await client.connect();
    try {
      await client.logout();
    } catch {
      // ignore — the auth+TLS handshake already proved reachability
    }
  },
});
