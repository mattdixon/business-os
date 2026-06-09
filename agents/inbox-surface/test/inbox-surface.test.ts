import { describe, it, expect } from 'vitest';
import surface, { SettingsSchema } from '../src/index.js';
import type {
  EmailInboxCapability,
  InboxMessageSummary,
  ListMessagesOpts,
  ListMessagesResult,
} from '@business-os/connector-sdk';

interface FakeLlm {
  reply: string;
  calls: Array<{ system?: string; userText: string }>;
}

interface FakeInboxState {
  lastListOpts?: ListMessagesOpts;
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
    receivedAt: new Date('2026-06-08T00:00:00Z'),
    unread: true,
    labels: [],
  };
}

function buildInbox(
  messages: InboxMessageSummary[],
): FakeInboxState & EmailInboxCapability {
  const state: FakeInboxState = {};
  return Object.assign(state, {
    listMessages: async (opts: ListMessagesOpts): Promise<ListMessagesResult> => {
      state.lastListOpts = opts;
      return { messages, nextCursor: null };
    },
    getMessage: async () => {
      throw new Error('not used');
    },
    markRead: async () => {},
    markUnread: async () => {},
    archive: async () => {},
    trash: async () => {},
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

describe('agent-inbox-surface', () => {
  it('manifest declares llm + email-inbox + manual schedule', () => {
    expect(surface.manifest.slug).toBe('inbox-surface');
    expect(surface.manifest.requiredConnectors).toContain('llm');
    expect(surface.manifest.requiredConnectors).toContain('email-inbox');
    expect(surface.manifest.schedule).toEqual({ kind: 'manual' });
  });

  it('settings defaults: 3 day window, 15 digest, no vips', () => {
    const s = SettingsSchema.parse({});
    expect(s.windowDays).toBe(3);
    expect(s.digestSize).toBe(15);
    expect(s.vipSenders).toEqual([]);
    expect(s.maxMessages).toBe(200);
  });

  it('lists with since = now - windowDays and unreadOnly = true', async () => {
    const messages = [msg('1', 'a@a.com')];
    const inbox = buildInbox(messages);
    const llm = fakeLlm(
      JSON.stringify({
        scores: [{ id: '1', score: 0.5, reason: 'maybe' }],
      }),
    );
    const ctx = buildCtx({ settings: { windowDays: 5 }, llm, inbox });
    await surface.run(ctx as never, undefined);
    expect(inbox.lastListOpts?.unreadOnly).toBe(true);
    expect(inbox.lastListOpts?.since).toBeInstanceOf(Date);
    const ageMs = Date.now() - inbox.lastListOpts!.since!.getTime();
    // 5 days minus tiny clock skew.
    const fiveDays = 5 * 24 * 60 * 60 * 1000;
    expect(ageMs).toBeGreaterThanOrEqual(fiveDays - 1000);
    expect(ageMs).toBeLessThan(fiveDays + 5_000);
  });

  it('VIP senders are scored 1.0 regardless of LLM', async () => {
    const messages = [
      msg('1', 'newsletter@news.com', 'Weekly update'),
      msg('2', 'boss@acme.com', 'Important'),
      msg('3', 'random@other.com', 'Question?'),
    ];
    const inbox = buildInbox(messages);
    const llm = fakeLlm(
      JSON.stringify({
        scores: [
          { id: '1', score: 0.9, reason: 'asks a question' }, // would beat boss by LLM
          { id: '2', score: 0.1, reason: 'no clear ask' },
          { id: '3', score: 0.5, reason: 'maybe' },
        ],
      }),
    );
    const audits: Array<{ action: string; meta?: Record<string, unknown> }> = [];
    const ctx = buildCtx({
      settings: { vipSenders: ['boss@acme.com'], digestSize: 3 },
      llm,
      inbox,
      audits,
    });
    const result = await surface.run(ctx as never, undefined);
    expect(result.ok).toBe(true);
    const digest = (result.details!['digest'] as Array<{ id: string; score: number; reason: string }>);
    // boss must be first with score 1.0.
    expect(digest[0]!.id).toBe('2');
    expect(digest[0]!.score).toBe(1.0);
    expect(digest[0]!.reason).toBe('VIP sender');
    // Newsletter (high LLM) is second.
    expect(digest[1]!.id).toBe('1');
    expect(audits.find((a) => a.action === 'inbox.surface.digested')?.meta).toMatchObject({
      totalScanned: 3,
      surfaced: 3,
    });
  });

  it('cuts the digest to digestSize and preserves descending score order', async () => {
    const messages = Array.from({ length: 5 }, (_, i) =>
      msg(String(i + 1), `s${i + 1}@x.com`),
    );
    const inbox = buildInbox(messages);
    const llm = fakeLlm(
      JSON.stringify({
        scores: [
          { id: '1', score: 0.1, reason: 'r1' },
          { id: '2', score: 0.9, reason: 'r2' },
          { id: '3', score: 0.5, reason: 'r3' },
          { id: '4', score: 0.7, reason: 'r4' },
          { id: '5', score: 0.3, reason: 'r5' },
        ],
      }),
    );
    const ctx = buildCtx({ settings: { digestSize: 3 }, llm, inbox });
    const result = await surface.run(ctx as never, undefined);
    const digest = result.details!['digest'] as Array<{ id: string; score: number }>;
    expect(digest.map((d) => d.id)).toEqual(['2', '4', '3']);
  });

  it('returns ok=false on unparseable LLM output', async () => {
    const messages = [msg('1', 'a@a.com')];
    const inbox = buildInbox(messages);
    const llm = fakeLlm('not json');
    const ctx = buildCtx({ settings: {}, llm, inbox });
    const result = await surface.run(ctx as never, undefined);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/unparseable/);
  });

  it('handles empty inbox without invoking the LLM', async () => {
    const inbox = buildInbox([]);
    const llm = fakeLlm('{"scores":[]}');
    const ctx = buildCtx({ settings: {}, llm, inbox });
    const result = await surface.run(ctx as never, undefined);
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/no unread/);
    expect(llm.calls).toEqual([]);
  });
});
