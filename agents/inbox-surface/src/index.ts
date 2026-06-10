import { z } from 'zod';
import {
  defineAgent,
  LlmPickerSchema,
  resolveLlm,
  type AgentResult,
} from '@business-os/agent-sdk';
import type {
  EmailInboxCapability,
  InboxMessageSummary,
  ListMessagesResult,
} from '@business-os/connector-sdk';

/**
 * Inbox-surface agent.
 *
 * Produces a ranked digest of the unread messages most likely to need a
 * human response. VIP senders are pinned to the top. Result.details.digest
 * is what the runs UI renders.
 */

const InputSchema = z.object({}).optional();

const SettingsSchema = z.object({
  llm: LlmPickerSchema.default({}),
  maxMessages: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(200)
    .describe('How many recent unread messages to score. Larger = more comprehensive, slower, more tokens.'),
  windowDays: z
    .number()
    .int()
    .min(1)
    .max(60)
    .default(3)
    .describe('Only consider messages received in the last N days.'),
  vipSenders: z
    .array(z.string())
    .default([])
    .describe('Senders that always score 1.0 and pin to the top of the digest. One email or domain per line.'),
  digestSize: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(15)
    .describe('Top N messages to include in the final ranked digest.'),
});

type Settings = z.infer<typeof SettingsSchema>;

const PAGE_SIZE = 200;
const SCORE_BATCH = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

const ScoringSchema = z.object({
  scores: z.array(
    z.object({
      id: z.string(),
      score: z.number().min(0).max(1),
      reason: z.string(),
    }),
  ),
});
type Scoring = z.infer<typeof ScoringSchema>;

const SYSTEM_PROMPT = `You score email messages on whether they need a response from a human.

For each message, return:
  - score in [0, 1]: 1.0 = clearly needs a human response now, 0.0 = no response needed
  - reason: one short sentence explaining the score

Signals that raise the score:
  - direct question to the user
  - time-sensitive request (deadline, meeting, decision)
  - decision needed
  - follow-up request
  - message from a key stakeholder

Signals that lower the score:
  - newsletter / marketing / notification / receipt / automated update
  - no clear ask
  - already-handled thread

Output ONLY valid JSON in this exact shape:

{ "scores": [ { "id": "<id>", "score": 0.0, "reason": "<one sentence>" } ] }

Rules:
- One entry per input message, with the id verbatim.
- Reasons stay under 20 words.`;

function userPromptForBatch(messages: InboxMessageSummary[]): string {
  const lines = messages.map(
    (m) =>
      `id: ${m.id}\nfrom: ${m.from}\nreceived: ${m.receivedAt.toISOString()}\nsubject: ${m.subject}\nsnippet: ${m.snippet}`,
  );
  return `Messages to score:\n\n${lines.join('\n---\n')}`;
}

function parseScoringJson(raw: string): Scoring {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const obj = JSON.parse(trimmed) as unknown;
  return ScoringSchema.parse(obj);
}

export function senderIsVip(
  from: string,
  vipSenders: ReadonlyArray<string>,
): boolean {
  if (vipSenders.length === 0) return false;
  const haystack = from.toLowerCase();
  for (const v of vipSenders) {
    const needle = v.trim().toLowerCase();
    if (!needle) continue;
    if (haystack.includes(needle)) return true;
  }
  return false;
}

async function collectMessages(
  inbox: EmailInboxCapability,
  settings: Settings,
): Promise<InboxMessageSummary[]> {
  const since = new Date(Date.now() - settings.windowDays * DAY_MS);
  const collected: InboxMessageSummary[] = [];
  let cursor: string | undefined;
  while (collected.length < settings.maxMessages) {
    const remaining = settings.maxMessages - collected.length;
    const pageSize = Math.min(PAGE_SIZE, remaining);
    const page: ListMessagesResult = await inbox.listMessages({
      unreadOnly: true,
      since,
      pageSize,
      cursor,
    });
    collected.push(...page.messages);
    if (!page.nextCursor || page.messages.length === 0) break;
    cursor = page.nextCursor;
  }
  return collected.slice(0, settings.maxMessages);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

interface DigestEntry {
  id: string;
  from: string;
  subject: string;
  score: number;
  reason: string;
  snippet: string;
  receivedAt: Date;
}

export default defineAgent({
  manifest: {
    slug: 'inbox-surface',
    version: '0.0.1',
    displayName: 'Inbox Surface',
    description:
      'Score recent unread messages on response need and surface the top items as a ranked digest.',
    requiredConnectors: ['llm', 'email-inbox'],
    settingsSchema: SettingsSchema,
    inputSchema: InputSchema,
    schedule: { kind: 'manual' },
  },
  run: async (ctx): Promise<AgentResult> => {
    const settings = ctx.settings;
    const inbox = (await ctx.connector('email-inbox')) as EmailInboxCapability;

    const messages = await collectMessages(inbox, settings);
    if (messages.length === 0) {
      return {
        ok: true,
        summary: `no unread messages in last ${settings.windowDays} days`,
        details: { totalScanned: 0, digest: [] },
      };
    }

    const llm = await resolveLlm(ctx, settings.llm);
    const scoreById = new Map<string, { score: number; reason: string }>();

    let totalUsageInput = 0;
    let totalUsageOutput = 0;

    for (const batch of chunk(messages, SCORE_BATCH)) {
      const response = await llm.complete({
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPromptForBatch(batch) }],
      });
      totalUsageInput += response.usage?.inputTokens ?? 0;
      totalUsageOutput += response.usage?.outputTokens ?? 0;

      let parsed: Scoring;
      try {
        parsed = parseScoringJson(response.content);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.logger.error(
          { rawHead: response.content.slice(0, 200), parseError: message },
          'inbox-surface.parse_failed',
        );
        return {
          ok: false,
          summary: `model returned unparseable output: ${message}`,
          details: { stopReason: response.stopReason },
        };
      }
      for (const s of parsed.scores) {
        scoreById.set(s.id, { score: s.score, reason: s.reason });
      }
    }

    const entries: DigestEntry[] = messages.map((m) => {
      const llmScore = scoreById.get(m.id);
      const vip = senderIsVip(m.from, settings.vipSenders);
      const score = vip ? 1.0 : llmScore?.score ?? 0;
      const reason = vip
        ? 'VIP sender'
        : llmScore?.reason ?? 'no LLM score returned for this message';
      return {
        id: m.id,
        from: m.from,
        subject: m.subject,
        score,
        reason,
        snippet: m.snippet,
        receivedAt: m.receivedAt,
      };
    });

    entries.sort((a, b) => b.score - a.score);
    const digest = entries.slice(0, settings.digestSize);

    await ctx.audit('inbox.surface.digested', {
      totalScanned: messages.length,
      surfaced: digest.length,
    });

    return {
      ok: true,
      summary: `surfaced ${digest.length} / ${messages.length} messages needing attention (window: last ${settings.windowDays} days)`,
      details: {
        totalScanned: messages.length,
        surfaced: digest.length,
        digest,
        usage: { inputTokens: totalUsageInput, outputTokens: totalUsageOutput },
      },
    };
  },
});

export { InputSchema, SettingsSchema };
