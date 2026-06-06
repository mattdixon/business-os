import { describe, it, expect } from 'vitest';
import leadgen, { SettingsSchema } from '../src/index.js';

/**
 * Unit tests against a fake AgentContext. Real DB integration is unnecessary
 * here — that's covered by runtime/run.integration. We're testing the agent's
 * own logic: prompt → parse → audit → result.
 */

interface FakeLlm {
  reply: string;
  calls: Array<{ system?: string; userText: string }>;
}

function fakeLlm(reply: string): FakeLlm {
  return { reply, calls: [] };
}

function buildCtx(opts: {
  settings: unknown;
  llm: FakeLlm;
  audit?: Array<{ action: string; meta?: Record<string, unknown> }>;
}) {
  const parsedSettings = SettingsSchema.parse(opts.settings);
  const audits = opts.audit ?? [];
  const log = () => {};
  return {
    settings: parsedSettings,
    runId: 'test-run',
    db: {},
    jobs: { enqueue: async () => 'job' },
    logger: { trace: log, debug: log, info: log, warn: log, error: log },
    audit: async (action: string, meta?: Record<string, unknown>) => {
      audits.push({ action, meta });
    },
    connector: async (cap: 'llm', resolverOpts?: { providerSlug?: string }) => {
      if (cap !== 'llm') throw new Error('unexpected capability ' + cap);
      // The fake LLM ignores model/provider for this test (the picker plumbing
      // is exercised in agent-sdk's resolveLlm tests).
      void resolverOpts;
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
            usage: { inputTokens: 100, outputTokens: 200 },
          };
        },
      };
    },
  };
}

const VALID_REPLY = JSON.stringify({
  drafts: [
    {
      prospect: {
        company: 'Acme Concrete',
        role: 'VP Operations',
        why: 'Mid-market concrete contractor in the seed region',
      },
      outreach: {
        subject: 'Concrete-pour scheduling for Acme — 90 days out',
        body:
          'Saw Acme is bidding on the new transit hub. Most contractors at your scale lose 2-3 days per pour to scheduling drift; we install the system that closes that gap. Worth 15 minutes next week?',
      },
    },
  ],
});

describe('agent-leadgen', () => {
  it('manifest declares llm capability + manual schedule', () => {
    expect(leadgen.manifest.slug).toBe('leadgen');
    expect(leadgen.manifest.requiredConnectors).toContain('llm');
    expect(leadgen.manifest.schedule.kind).toBe('manual');
  });

  it('runs end-to-end against a fake LLM and audits each draft', async () => {
    const llm = fakeLlm(VALID_REPLY);
    const audits: Array<{ action: string; meta?: Record<string, unknown> }> = [];
    const ctx = buildCtx({
      settings: { icp: 'mid-market concrete contractors $5M+ revenue' },
      llm,
      audit: audits,
    });
    const result = await leadgen.run(ctx as never, { seed: 'concrete contractors Denver' });
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/Drafted 1 prospects/);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe('leadgen.drafted');
    expect(audits[0]!.meta?.company).toBe('Acme Concrete');
    // Sent the ICP and seed to the model.
    expect(llm.calls[0]!.userText).toContain('mid-market concrete contractors');
    expect(llm.calls[0]!.userText).toContain('concrete contractors Denver');
  });

  it('respects settings.maxPerRun ceiling even when input.count is higher', async () => {
    const llm = fakeLlm(VALID_REPLY);
    const ctx = buildCtx({
      settings: { icp: 'x', maxPerRun: 3 },
      llm,
    });
    await leadgen.run(ctx as never, { seed: 'x', count: 50 });
    // The user prompt should ask for 3, not 50.
    expect(llm.calls[0]!.userText).toContain('Generate exactly 3 drafts.');
  });

  it('tolerates fenced JSON output from the model', async () => {
    const llm = fakeLlm('```json\n' + VALID_REPLY + '\n```');
    const ctx = buildCtx({ settings: { icp: 'x' }, llm });
    const result = await leadgen.run(ctx as never, { seed: 'x' });
    expect(result.ok).toBe(true);
  });

  it('returns ok=false with a parse error when output is not valid JSON', async () => {
    const llm = fakeLlm('hi! I refuse to follow the schema today.');
    const ctx = buildCtx({ settings: { icp: 'x' }, llm });
    const result = await leadgen.run(ctx as never, { seed: 'x' });
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/unparseable/);
  });

  it('rejects input that fails schema validation at the agent boundary', async () => {
    const llm = fakeLlm(VALID_REPLY);
    const ctx = buildCtx({ settings: { icp: 'x' }, llm });
    await expect(leadgen.run(ctx as never, { seed: '' })).rejects.toThrow();
  });

  it('settings: icp is required', () => {
    expect(() => SettingsSchema.parse({})).toThrow(/icp/);
  });
});
