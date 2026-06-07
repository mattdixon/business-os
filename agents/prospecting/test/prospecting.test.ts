import { describe, it, expect } from 'vitest';
import prospecting, { SettingsSchema } from '../src/index.js';

interface FakeLlm {
  reply: string;
  calls: Array<{ system?: string; userText: string }>;
}

interface FakeEmail {
  sent: Array<{ to: string | string[]; subject: string; text?: string }>;
}

function fakeLlm(reply: string): FakeLlm {
  return { reply, calls: [] };
}

function buildCtx(opts: {
  settings: unknown;
  llm: FakeLlm;
  email?: FakeEmail;
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
    connector: async (cap: 'llm' | 'email') => {
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
              usage: { inputTokens: 50, outputTokens: 100 },
            };
          },
        };
      }
      if (cap === 'email' && opts.email) {
        return {
          send: async (msg: { to: string; subject: string; text?: string }) => {
            opts.email!.sent.push(msg);
            return { messageId: 'fake-msg-id' };
          },
        };
      }
      throw new Error('unexpected capability ' + cap);
    },
  };
}

const VALID_REPLY = JSON.stringify({
  research:
    'Acme Concrete is a mid-market concrete contractor in Denver, recently bid on the new transit hub.',
  outreach: {
    subject: 'Concrete-pour scheduling for Acme — 90 days out',
    body:
      'Saw Acme is bidding on the new transit hub. Most contractors at your scale lose 2-3 days per pour to scheduling drift; we install the system that closes that gap. Worth 15 minutes next week?',
  },
});

describe('agent-prospecting', () => {
  it('manifest declares llm + email + manual schedule', () => {
    expect(prospecting.manifest.slug).toBe('prospecting');
    expect(prospecting.manifest.requiredConnectors).toContain('llm');
    expect(prospecting.manifest.requiredConnectors).toContain('email');
  });

  it('settings require icp + offer', () => {
    expect(() => SettingsSchema.parse({})).toThrow();
    expect(() => SettingsSchema.parse({ icp: 'x' })).toThrow();
    expect(() => SettingsSchema.parse({ icp: 'x', offer: 'y' })).not.toThrow();
  });

  it('drafts without sending when send.enabled is false (default)', async () => {
    const llm = fakeLlm(VALID_REPLY);
    const email: FakeEmail = { sent: [] };
    const audits: Array<{ action: string; meta?: Record<string, unknown> }> = [];
    const ctx = buildCtx({
      settings: { icp: 'mid-market concrete', offer: 'scheduling SaaS' },
      llm,
      email,
      audits,
    });
    const result = await prospecting.run(ctx as never, { company: 'Acme Concrete' });
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/send disabled/);
    expect(email.sent).toEqual([]);
    expect(audits.map((a) => a.action)).toContain('prospecting.drafted');
    expect(audits.map((a) => a.action)).not.toContain('prospecting.sent');
  });

  it('sends via email connector when settings.send.enabled and fallbackTo are set', async () => {
    const llm = fakeLlm(VALID_REPLY);
    const email: FakeEmail = { sent: [] };
    const ctx = buildCtx({
      settings: {
        icp: 'mid-market concrete',
        offer: 'scheduling SaaS',
        send: { enabled: true, fallbackTo: 'demo@example.com' },
      },
      llm,
      email,
    });
    const result = await prospecting.run(ctx as never, { company: 'Acme Concrete' });
    expect(result.ok).toBe(true);
    expect(email.sent.length).toBe(1);
    expect(email.sent[0]!.to).toBe('demo@example.com');
    expect(email.sent[0]!.subject).toMatch(/Concrete-pour/);
  });

  it('skips send when send.enabled but no recipient resolvable', async () => {
    const llm = fakeLlm(VALID_REPLY);
    const email: FakeEmail = { sent: [] };
    const ctx = buildCtx({
      settings: {
        icp: 'x',
        offer: 'y',
        send: { enabled: true },
      },
      llm,
      email,
    });
    const result = await prospecting.run(ctx as never, { company: 'Acme' });
    expect(result.ok).toBe(true);
    expect(email.sent).toEqual([]);
  });

  it('input.email overrides settings.send.fallbackTo', async () => {
    const llm = fakeLlm(VALID_REPLY);
    const email: FakeEmail = { sent: [] };
    const ctx = buildCtx({
      settings: {
        icp: 'x',
        offer: 'y',
        send: { enabled: true, fallbackTo: 'fallback@example.com' },
      },
      llm,
      email,
    });
    await prospecting.run(ctx as never, {
      company: 'Acme',
      email: 'override@example.com',
    });
    expect(email.sent[0]!.to).toBe('override@example.com');
  });

  it('returns ok=false on unparseable model output', async () => {
    const llm = fakeLlm('I refuse the schema today.');
    const ctx = buildCtx({
      settings: { icp: 'x', offer: 'y' },
      llm,
      email: { sent: [] },
    });
    const result = await prospecting.run(ctx as never, { company: 'Acme' });
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/unparseable/);
  });
});
