import { describe, it, expect } from 'vitest';
import cleanup, { SettingsSchema } from '../src/index.js';
import type {
  EmailInboxCapability,
  InboxMessageSummary,
  ListMessagesOpts,
  ListMessagesResult,
} from '@frontrangesystems/business-os-connector-sdk';

interface FakeLlm {
  reply: string;
  calls: Array<{ system?: string; userText: string }>;
}

interface FakeInbox {
  pages: ListMessagesResult[];
  archived: string[];
  trashed: string[];
}

function fakeLlm(reply: string): FakeLlm {
  return { reply, calls: [] };
}

function msg(
  id: string,
  from: string,
  subject = `Subject ${id}`,
): InboxMessageSummary {
  return {
    id,
    threadId: 't-' + id,
    from,
    to: ['me@example.com'],
    subject,
    snippet: 'snippet ' + id,
    receivedAt: new Date('2026-06-01T00:00:00Z'),
    unread: true,
    labels: [],
  };
}

function buildInbox(messages: InboxMessageSummary[]): FakeInbox & EmailInboxCapability {
  const state: FakeInbox = {
    pages: [{ messages, nextCursor: null }],
    archived: [],
    trashed: [],
  };
  return Object.assign(state, {
    listMessages: async (_opts: ListMessagesOpts): Promise<ListMessagesResult> => ({
      messages: state.pages[0]!.messages,
      nextCursor: null,
    }),
    getMessage: async () => {
      throw new Error('not used');
    },
    markRead: async () => {},
    markUnread: async () => {},
    archive: async (ids: string[]) => {
      state.archived.push(...ids);
    },
    trash: async (ids: string[]) => {
      state.trashed.push(...ids);
    },
    deletePermanently: async () => {},
    search: async () => ({ messages: [], nextCursor: null }),
  });
}

function buildCtx(opts: {
  settings: unknown;
  llm: FakeLlm;
  inbox: EmailInboxCapability;
  audits?: Array<{ action: string; meta?: Record<string, unknown> }>;
}) {
  const parsedSettings = SettingsSchema.parse(opts.settings);
  const audits = opts.audits ?? [];
  const noop = () => {};
  return {
    settings: parsedSettings,
    runId: 'test-run',
    db: {},
    jobs: { enqueue: async () => 'job' },
    logger: { trace: noop, debug: noop, info: noop, warn: noop, error: noop },
    audit: async (action: string, meta?: Record<string, unknown>) => {
      audits.push({ action, meta });
    },
    connector: async (cap: string) => {
      if (cap === 'llm') {
        return {
          complete: async (req: {
            system?: string;
            messages: Array<{ role: string; content: string }>;
          }) => {
            opts.llm.calls.push({
              system: req.system,
              userText: req.messages.map((m) => m.content).join('\n'),
            });
            return {
              content: opts.llm.reply,
              stopReason: 'end' as const,
              usage: { inputTokens: 10, outputTokens: 20 },
            };
          },
        };
      }
      if (cap === 'email-inbox') return opts.inbox;
      throw new Error('unexpected capability ' + cap);
    },
  };
}

describe('agent-inbox-cleanup', () => {
  it('manifest declares llm + email-inbox + manual schedule', () => {
    expect(cleanup.manifest.slug).toBe('inbox-cleanup');
    expect(cleanup.manifest.requiredConnectors).toContain('llm');
    expect(cleanup.manifest.requiredConnectors).toContain('email-inbox');
    expect(cleanup.manifest.schedule).toEqual({ kind: 'manual' });
  });

  it('settings defaults are safe: dry-run, unreadOnly, no neverTouch', () => {
    const s = SettingsSchema.parse({});
    expect(s.cleanupAction).toBe('dry-run');
    expect(s.unreadOnly).toBe(true);
    expect(s.neverTouchSenders).toEqual([]);
    expect(s.maxMessages).toBe(500);
  });

  it('dry-run does not mutate inbox even with archive/trash decisions', async () => {
    // 4 messages from newsletter@news.com → group size 4 (>= 3)
    const messages = [
      msg('1', 'Newsletter <newsletter@news.com>'),
      msg('2', 'newsletter@news.com'),
      msg('3', 'Newsletter <newsletter@news.com>'),
      msg('4', 'newsletter@news.com'),
    ];
    const inbox = buildInbox(messages);
    const llm = fakeLlm(
      JSON.stringify({
        decisions: [{ sender: 'newsletter@news.com', action: 'trash' }],
      }),
    );
    const audits: Array<{ action: string; meta?: Record<string, unknown> }> = [];
    const ctx = buildCtx({ settings: {}, llm, inbox, audits });
    const result = await cleanup.run(ctx as never, undefined);

    expect(result.ok).toBe(true);
    expect(inbox.archived).toEqual([]);
    expect(inbox.trashed).toEqual([]);
    expect(result.summary).toMatch(/would sweep/);
    expect(audits.find((a) => a.action === 'inbox.cleanup.batch')?.meta).toMatchObject({
      action: 'trash',
      dryRun: true,
    });
  });

  it('applies archive action when cleanupAction=archive (trash recommendations downgrade)', async () => {
    const messages = [
      msg('1', 'newsletter@news.com'),
      msg('2', 'newsletter@news.com'),
      msg('3', 'newsletter@news.com'),
    ];
    const inbox = buildInbox(messages);
    const llm = fakeLlm(
      JSON.stringify({
        decisions: [{ sender: 'newsletter@news.com', action: 'trash' }],
      }),
    );
    const ctx = buildCtx({
      settings: { cleanupAction: 'archive' },
      llm,
      inbox,
    });
    const result = await cleanup.run(ctx as never, undefined);
    expect(result.ok).toBe(true);
    // trash recommendation downgraded to archive
    expect(inbox.archived.sort()).toEqual(['1', '2', '3']);
    expect(inbox.trashed).toEqual([]);
  });

  it('honors neverTouchSenders by exact address and domain', async () => {
    const messages = [
      msg('1', 'boss@company.com'),
      msg('2', 'boss@company.com'),
      msg('3', 'Boss <boss@company.com>'),
      msg('4', 'spam@marketing.io'),
      msg('5', 'spam@marketing.io'),
      msg('6', 'spam@marketing.io'),
    ];
    const inbox = buildInbox(messages);
    const llm = fakeLlm(
      JSON.stringify({
        decisions: [
          { sender: 'boss@company.com', action: 'trash' },
          { sender: 'spam@marketing.io', action: 'trash' },
        ],
      }),
    );
    const ctx = buildCtx({
      settings: {
        cleanupAction: 'trash',
        // Domain rule for company.com — protects boss@.
        neverTouchSenders: ['company.com'],
      },
      llm,
      inbox,
    });
    const result = await cleanup.run(ctx as never, undefined);
    expect(result.ok).toBe(true);
    expect(inbox.trashed.sort()).toEqual(['4', '5', '6']);
    expect(inbox.trashed).not.toContain('1');
  });

  it('skips senders with fewer than 3 messages in batch', async () => {
    const messages = [
      msg('1', 'rare@rare.com'),
      msg('2', 'rare@rare.com'),
      msg('3', 'bulk@bulk.com'),
      msg('4', 'bulk@bulk.com'),
      msg('5', 'bulk@bulk.com'),
    ];
    const inbox = buildInbox(messages);
    const llm = fakeLlm(
      JSON.stringify({
        decisions: [{ sender: 'bulk@bulk.com', action: 'archive' }],
      }),
    );
    const ctx = buildCtx({
      settings: { cleanupAction: 'archive' },
      llm,
      inbox,
    });
    const result = await cleanup.run(ctx as never, undefined);
    expect(result.ok).toBe(true);
    expect(inbox.archived.sort()).toEqual(['3', '4', '5']);
    // The LLM was only asked about bulk@bulk.com.
    expect(llm.calls[0]!.userText).toMatch(/bulk@bulk\.com/);
    expect(llm.calls[0]!.userText).not.toMatch(/rare@rare\.com/);
  });

  it('returns ok=false on unparseable LLM output', async () => {
    const messages = [
      msg('1', 'foo@foo.com'),
      msg('2', 'foo@foo.com'),
      msg('3', 'foo@foo.com'),
    ];
    const inbox = buildInbox(messages);
    const llm = fakeLlm('not json at all');
    const ctx = buildCtx({ settings: {}, llm, inbox });
    const result = await cleanup.run(ctx as never, undefined);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/unparseable/);
  });

  it('returns early when no sender hits the group threshold', async () => {
    const messages = [
      msg('1', 'a@a.com'),
      msg('2', 'b@b.com'),
      msg('3', 'c@c.com'),
    ];
    const inbox = buildInbox(messages);
    const llm = fakeLlm('{"decisions": []}');
    const ctx = buildCtx({ settings: {}, llm, inbox });
    const result = await cleanup.run(ctx as never, undefined);
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/no sender/);
    // LLM not consulted.
    expect(llm.calls).toEqual([]);
  });
});
