import { describe, it, expect } from 'vitest';
import categorize, { SettingsSchema } from '../src/index.js';
import type {
  EmailInboxCapability,
  InboxMessageSummary,
  ListMessagesResult,
} from '@business-os/connector-sdk';

interface FakeLlm {
  reply: string;
  calls: Array<{ system?: string; userText: string }>;
}

interface FakeInbox {
  labelsApplied: Array<{ ids: string[]; labels: string[] }>;
}

function fakeLlm(reply: string): FakeLlm {
  return { reply, calls: [] };
}

function msg(id: string, subject = `Subject ${id}`): InboxMessageSummary {
  return {
    id,
    threadId: 't-' + id,
    from: `sender${id}@example.com`,
    to: ['me@example.com'],
    subject,
    snippet: 'snippet ' + id,
    receivedAt: new Date('2026-06-01T00:00:00Z'),
    unread: true,
    labels: [],
  };
}

function buildInbox(
  messages: InboxMessageSummary[],
  opts: { supportLabels?: boolean } = { supportLabels: true },
): FakeInbox & EmailInboxCapability {
  const state: FakeInbox = { labelsApplied: [] };
  const base: EmailInboxCapability = {
    listMessages: async (): Promise<ListMessagesResult> => ({
      messages,
      nextCursor: null,
    }),
    getMessage: async () => {
      throw new Error('not used');
    },
    markRead: async () => {},
    markUnread: async () => {},
    archive: async () => {},
    trash: async () => {},
    deletePermanently: async () => {},
    search: async () => ({ messages: [], nextCursor: null }),
  };
  if (opts.supportLabels) {
    base.addLabels = async (ids: string[], labels: string[]) => {
      state.labelsApplied.push({ ids, labels });
    };
  }
  return Object.assign(state, base);
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

describe('agent-inbox-categorize', () => {
  it('manifest declares llm + email-inbox + manual schedule', () => {
    expect(categorize.manifest.slug).toBe('inbox-categorize');
    expect(categorize.manifest.requiredConnectors).toContain('llm');
    expect(categorize.manifest.requiredConnectors).toContain('email-inbox');
    expect(categorize.manifest.schedule).toEqual({ kind: 'manual' });
  });

  it('settings defaults include the standard category vocabulary', () => {
    const s = SettingsSchema.parse({});
    expect(s.categories).toEqual(
      expect.arrayContaining([
        'Newsletter',
        'Receipt',
        'Notification',
        'Personal',
        'Work',
        'Action-Needed',
      ]),
    );
    expect(s.confidenceThreshold).toBe(0.6);
    expect(s.maxMessages).toBe(200);
  });

  it('applies labels only above threshold and groups bulk-applies per category', async () => {
    const messages = [msg('1'), msg('2'), msg('3'), msg('4')];
    const inbox = buildInbox(messages);
    const llm = fakeLlm(
      JSON.stringify({
        classifications: [
          { id: '1', category: 'Newsletter', confidence: 0.9 },
          { id: '2', category: 'Newsletter', confidence: 0.4 }, // below threshold
          { id: '3', category: 'Work', confidence: 0.8 },
          { id: '4', category: 'NotAReal', confidence: 0.9 }, // invalid category
        ],
      }),
    );
    const audits: Array<{ action: string; meta?: Record<string, unknown> }> = [];
    const ctx = buildCtx({ settings: {}, llm, inbox, audits });
    const result = await categorize.run(ctx as never, undefined);

    expect(result.ok).toBe(true);
    // Two label calls: one for Newsletter ([1]), one for Work ([3]).
    expect(inbox.labelsApplied.length).toBe(2);
    const byLabel = Object.fromEntries(
      inbox.labelsApplied.map((a) => [a.labels[0]!, a.ids]),
    );
    expect(byLabel['Newsletter']).toEqual(['1']);
    expect(byLabel['Work']).toEqual(['3']);
    expect(result.summary).toMatch(/categorized 2 \/ 4/);
    // Below-threshold and invalid both counted.
    expect(result.details).toMatchObject({ belowThreshold: 1, invalidCategory: 1 });
    // Audits one per category applied.
    const applied = audits.filter((a) => a.action === 'inbox.categorize.applied');
    expect(applied.length).toBe(2);
  });

  it('returns ok=false when the connector does not support labels', async () => {
    const messages = [msg('1')];
    const inbox = buildInbox(messages, { supportLabels: false });
    const llm = fakeLlm('{"classifications":[]}');
    const ctx = buildCtx({ settings: {}, llm, inbox });
    const result = await categorize.run(ctx as never, undefined);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/does not support labels/);
  });

  it('returns ok=false on unparseable LLM output', async () => {
    const messages = [msg('1')];
    const inbox = buildInbox(messages);
    const llm = fakeLlm('garbage');
    const ctx = buildCtx({ settings: {}, llm, inbox });
    const result = await categorize.run(ctx as never, undefined);
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/unparseable/);
  });

  it('returns ok=true with empty inbox without calling the LLM', async () => {
    const inbox = buildInbox([]);
    const llm = fakeLlm('{"classifications":[]}');
    const ctx = buildCtx({ settings: {}, llm, inbox });
    const result = await categorize.run(ctx as never, undefined);
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/empty/);
    expect(llm.calls).toEqual([]);
  });
});
