import { z } from 'zod';
import {
  defineAgent,
  LlmPickerSchema,
  resolveLlm,
  type AgentResult,
} from '@business-os/agent-sdk';

/**
 * Lead-generation agent.
 *
 * Given a seed (industry keyword or example company), uses the configured
 * LLM provider to produce N prospect personas + a first-touch outreach draft
 * for each. Each draft is recorded via ctx.audit so the operator UI can
 * surface them for review.
 *
 * This first cut returns the drafts in the run result. The follow-up slice
 * adds a CRM capability so the agent can upsert contacts directly; that's
 * a connector swap, not an agent change.
 *
 * Per CLAUDE.md, all knobs live in settings (validated below) — the agent
 * never reads process.env directly.
 */

const InputSchema = z.object({
  /** Seed industry / market keyword or example company name. */
  seed: z.string().min(1),
  /** Per-run override of the manifest's `maxPerRun` ceiling. */
  count: z.number().int().positive().max(50).optional(),
});

const SettingsSchema = z.object({
  /** Free-form ICP description — fed to the model as context. */
  icp: z.string().min(1),
  /** Geographic or other targeting hints — optional. */
  targetingNotes: z.string().optional(),
  /** Hard ceiling per run, regardless of input.count. */
  maxPerRun: z.number().int().positive().max(50).default(10),
  /** Operator-picked LLM provider + model. See LlmPickerSchema in agent-sdk. */
  llm: LlmPickerSchema.default({}),
});

const DraftSchema = z.object({
  prospect: z.object({
    company: z.string(),
    role: z.string(),
    why: z.string(),
  }),
  outreach: z.object({
    subject: z.string(),
    body: z.string(),
  }),
});

const ModelResponseSchema = z.object({
  drafts: z.array(DraftSchema),
});
type ModelResponse = z.infer<typeof ModelResponseSchema>;

const SYSTEM_PROMPT = `You are a B2B SDR working for an operator who hired this Business OS install.
Given an ICP description and a seed (industry or example company), produce
prospect personas and an outreach draft for each.

Output ONLY valid JSON matching this exact schema (no preamble, no commentary):

{
  "drafts": [
    {
      "prospect": {
        "company": "<concrete plausible company name>",
        "role": "<concrete role at that company>",
        "why": "<one-sentence reason this fits the ICP>"
      },
      "outreach": {
        "subject": "<email subject, under 70 chars>",
        "body":    "<3-5 sentence first-touch email body>"
      }
    }
  ]
}

Rules:
- Companies must be plausible-sounding, not real businesses you've heard of.
- Subject lines stay specific. No "Quick question" / "Following up" / "Touching base".
- Bodies are direct, name the operator's offer in concrete terms, and end with one specific question or ask.
- No emojis. No "I hope this email finds you well".`;

const USER_PROMPT = (
  icp: string,
  seed: string,
  count: number,
  targetingNotes?: string,
): string =>
  [
    `ICP: ${icp}`,
    targetingNotes ? `Targeting notes: ${targetingNotes}` : null,
    `Seed: ${seed}`,
    `Generate exactly ${count} drafts.`,
  ]
    .filter(Boolean)
    .join('\n');

/** Tolerant JSON parser — the model occasionally wraps output in fences. */
function parseModelJson(raw: string): ModelResponse {
  const trimmed = raw.trim();
  const stripped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const obj = JSON.parse(stripped) as unknown;
  return ModelResponseSchema.parse(obj);
}

export default defineAgent({
  manifest: {
    slug: 'leadgen',
    version: '0.0.1',
    displayName: 'Lead Generation',
    description: 'Drafts prospect personas + first-touch outreach from a seed.',
    requiredConnectors: ['llm'],
    settingsSchema: SettingsSchema,
    inputSchema: InputSchema,
    schedule: { kind: 'manual' },
  },
  run: async (ctx, input): Promise<AgentResult> => {
    // Runtime already validated against inputSchema, but parse defensively in
    // case this agent is invoked outside the runtime path.
    const parsedInput = InputSchema.parse(input);
    const settings = ctx.settings;

    const requested = parsedInput.count ?? settings.maxPerRun;
    const count = Math.min(requested, settings.maxPerRun);

    const llm = await resolveLlm(ctx, settings.llm);
    const response = await llm.complete({
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: USER_PROMPT(
            settings.icp,
            parsedInput.seed,
            count,
            settings.targetingNotes,
          ),
        },
      ],
    });

    let parsed: ModelResponse;
    try {
      parsed = parseModelJson(response.content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.logger.error(
        { rawHead: response.content.slice(0, 200), parseError: message },
        'leadgen.parse_failed',
      );
      return {
        ok: false,
        summary: `model returned unparseable output: ${message}`,
        details: { stopReason: response.stopReason, usage: response.usage },
      };
    }

    // Trim back to count in case the model overshot.
    const drafts = parsed.drafts.slice(0, count);

    for (const d of drafts) {
      await ctx.audit('leadgen.drafted', {
        company: d.prospect.company,
        role: d.prospect.role,
        subject: d.outreach.subject,
      });
    }

    return {
      ok: true,
      summary: `Drafted ${drafts.length} prospects from seed "${parsedInput.seed}"`,
      details: {
        count: drafts.length,
        usage: response.usage,
        drafts,
      },
    };
  },
});

// Re-export the schemas so the client shell or operator UI can introspect.
export { InputSchema, SettingsSchema, DraftSchema, ModelResponseSchema };
