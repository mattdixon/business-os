import { z } from 'zod';
import {
  defineAgent,
  LlmPickerSchema,
  resolveLlm,
  type AgentResult,
} from '@business-os/agent-sdk';
import type { EmailCapability } from '@business-os/connector-sdk';

/**
 * Prospecting agent.
 *
 * Per company (or per-prospect lead) the operator hands the agent:
 *   - the target company name (and optional notes)
 *   - the operator-wide ICP description
 *   - the operator's offer / what they sell
 *
 * The agent uses the configured LLM to produce a tight research note +
 * first-touch outreach draft. If `settings.send.enabled` is true the
 * draft also goes through the active email capability (operator picks
 * email-stub for dev or a real Gmail/Outlook provider for prod). Either
 * way every produced artifact is audited.
 *
 * This is a per-lead workflow — usually triggered as a job from leadgen's
 * output or from a webhook. Manual triggers work too.
 */

const InputSchema = z.object({
  company: z.string().min(1),
  notes: z.string().optional(),
  /** Optional override of the recipient email (defaults to settings.fallbackTo). */
  email: z.string().email().optional(),
});

const SendSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    fromName: z.string().default('Sales'),
    fromAddress: z.string().email().optional(),
    /** Used when input.email is omitted — useful for sending tests to yourself. */
    fallbackTo: z.string().email().optional(),
  })
  .default({});

const SettingsSchema = z.object({
  icp: z.string().min(1).describe('Who the operator sells to (ICP).'),
  offer: z.string().min(1).describe('One-paragraph description of what the operator sells.'),
  llm: LlmPickerSchema.default({}),
  send: SendSettingsSchema,
});

const DraftSchema = z.object({
  research: z.string().describe('Short research note — what we learned about the company.'),
  outreach: z.object({
    subject: z.string(),
    body: z.string(),
  }),
});
type Draft = z.infer<typeof DraftSchema>;

const SYSTEM_PROMPT = `You research a single company on behalf of an operator and write a first-touch outreach email.

Output ONLY valid JSON matching this exact schema:

{
  "research": "<3-5 sentence note on the company: industry, signals that point to fit with the operator's ICP, any specific hooks worth opening with>",
  "outreach": {
    "subject": "<concrete subject line, under 70 chars>",
    "body":    "<3-5 sentence email body, direct, naming the operator's offer in concrete terms, ending with one specific question or ask>"
  }
}

Rules:
- The research note must be specific to the company — no generic "Acme is a leader in their industry" filler.
- The subject line stays specific. No "Quick question" / "Following up" / "Touching base".
- The body avoids "I hope this email finds you well", emojis, and exclamation points.
- Do NOT fabricate metrics, customer counts, or product details about the operator. Only use what's in the offer description.`;

function userPrompt(icp: string, offer: string, company: string, notes?: string): string {
  return [
    `Operator's ICP: ${icp}`,
    `Operator's offer: ${offer}`,
    `Target company: ${company}`,
    notes ? `Operator notes: ${notes}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function parseDraftJson(raw: string): Draft {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const obj = JSON.parse(trimmed) as unknown;
  return DraftSchema.parse(obj);
}

export default defineAgent({
  manifest: {
    slug: 'prospecting',
    version: '0.0.1',
    displayName: 'Prospecting',
    description: 'Researches a company and drafts (and optionally sends) first-touch outreach.',
    requiredConnectors: ['llm', 'email'],
    settingsSchema: SettingsSchema,
    inputSchema: InputSchema,
    schedule: { kind: 'manual' },
  },
  run: async (ctx, input): Promise<AgentResult> => {
    const parsedInput = InputSchema.parse(input);
    const settings = ctx.settings;

    const llm = await resolveLlm(ctx, settings.llm);
    const response = await llm.complete({
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: userPrompt(
            settings.icp,
            settings.offer,
            parsedInput.company,
            parsedInput.notes,
          ),
        },
      ],
    });

    let draft: Draft;
    try {
      draft = parseDraftJson(response.content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.logger.error(
        { rawHead: response.content.slice(0, 200), parseError: message },
        'prospecting.parse_failed',
      );
      return {
        ok: false,
        summary: `model returned unparseable output: ${message}`,
        details: { stopReason: response.stopReason, usage: response.usage },
      };
    }

    await ctx.audit('prospecting.drafted', {
      company: parsedInput.company,
      subject: draft.outreach.subject,
    });

    // Optional send via the active email capability.
    let sent: { messageId: string } | null = null;
    if (settings.send.enabled) {
      const to = parsedInput.email ?? settings.send.fallbackTo;
      if (!to) {
        ctx.logger.warn(
          { company: parsedInput.company },
          'prospecting.send.skipped — no recipient (input.email and settings.send.fallbackTo both unset)',
        );
      } else {
        const email = (await ctx.connector('email')) as EmailCapability;
        const subjectPrefix = settings.send.fromName ? `[${settings.send.fromName}] ` : '';
        sent = await email.send({
          to,
          subject: subjectPrefix + draft.outreach.subject,
          text: draft.outreach.body,
        });
        await ctx.audit('prospecting.sent', {
          company: parsedInput.company,
          to,
          messageId: sent.messageId,
        });
      }
    }

    return {
      ok: true,
      summary: sent
        ? `Drafted + sent to ${parsedInput.email ?? settings.send.fallbackTo}`
        : `Drafted (send disabled) for ${parsedInput.company}`,
      details: {
        usage: response.usage,
        draft,
        sent,
      },
    };
  },
});

export { InputSchema, SettingsSchema, DraftSchema };
