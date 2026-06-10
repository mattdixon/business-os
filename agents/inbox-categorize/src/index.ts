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
 * Inbox-categorize agent.
 *
 * Walks the unread inbox and applies a label/category to each message
 * according to the operator's category vocabulary. Skips messages whose
 * LLM confidence falls below `confidenceThreshold` — better unlabeled than
 * mis-labeled.
 */

const InputSchema = z.object({}).optional();

const DEFAULT_CATEGORIES = [
  'Newsletter',
  'Receipt',
  'Notification',
  'Personal',
  'Work',
  'Action-Needed',
];

const SettingsSchema = z.object({
  llm: LlmPickerSchema.default({}),
  maxMessages: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(200)
    .describe('How many recent messages to classify in one run.'),
  categories: z
    .array(z.string())
    .default(DEFAULT_CATEGORIES)
    .describe('Your label vocabulary. The model picks from these — one per message.'),
  confidenceThreshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.6)
    .describe('Minimum model confidence (0-1) before a label is applied. Lower = more labels applied but more noise.'),
  unreadOnly: z
    .boolean()
    .default(true)
    .describe('Only categorize unread messages.'),
});

type Settings = z.infer<typeof SettingsSchema>;

const PAGE_SIZE = 200;
/** Per-LLM-call batch size — keep the prompt under reasonable token cost. */
const CLASSIFY_BATCH = 50;

const ClassificationSchema = z.object({
  classifications: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
type Classification = z.infer<typeof ClassificationSchema>;

function systemPrompt(categories: ReadonlyArray<string>): string {
  return `You categorize email messages for an operator.

Choose EXACTLY ONE category per message from this list:

${categories.map((c) => `  - ${c}`).join('\n')}

For each message return a confidence in [0, 1] reflecting how sure you
are. Low confidence (<0.6) means the message is ambiguous or doesn't
clearly fit any category — be honest, the operator filters by confidence.

Output ONLY valid JSON in this exact shape:

{ "classifications": [ { "id": "<id>", "category": "<one of the categories>", "confidence": 0.0 } ] }

Rules:
- One entry per input message, with the id verbatim.
- Category MUST match one from the list exactly (case-sensitive).
- Prefer lower confidence over inventing a category.`;
}

function userPromptForBatch(messages: InboxMessageSummary[]): string {
  const lines = messages.map(
    (m) => `id: ${m.id}\nfrom: ${m.from}\nsubject: ${m.subject}\nsnippet: ${m.snippet}`,
  );
  return `Messages to classify:\n\n${lines.join('\n---\n')}`;
}

function parseClassificationJson(raw: string): Classification {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const obj = JSON.parse(trimmed) as unknown;
  return ClassificationSchema.parse(obj);
}

async function collectMessages(
  inbox: EmailInboxCapability,
  settings: Settings,
): Promise<InboxMessageSummary[]> {
  const collected: InboxMessageSummary[] = [];
  let cursor: string | undefined;
  while (collected.length < settings.maxMessages) {
    const remaining = settings.maxMessages - collected.length;
    const pageSize = Math.min(PAGE_SIZE, remaining);
    const page: ListMessagesResult = await inbox.listMessages({
      unreadOnly: settings.unreadOnly,
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

export default defineAgent({
  manifest: {
    slug: 'inbox-categorize',
    version: '0.0.1',
    displayName: 'Inbox Categorize',
    description:
      'Apply a label/category to each unread message using an LLM classifier and an operator-defined vocabulary.',
    requiredConnectors: ['llm', 'email-inbox'],
    settingsSchema: SettingsSchema,
    inputSchema: InputSchema,
    schedule: { kind: 'manual' },
    supportedTriggers: ['manual', 'cron', 'event'] as const,
  },
  run: async (ctx): Promise<AgentResult> => {
    const settings = ctx.settings;
    const inbox = (await ctx.connector('email-inbox')) as EmailInboxCapability;

    if (settings.categories.length === 0) {
      return {
        ok: false,
        summary: 'no categories configured — set at least one in settings.categories',
      };
    }
    const allowedCategories = new Set(settings.categories);

    const messages = await collectMessages(inbox, settings);
    if (messages.length === 0) {
      return { ok: true, summary: 'inbox empty — nothing to categorize', details: { scanned: 0 } };
    }

    if (!inbox.addLabels) {
      ctx.logger.warn(
        { provider: 'unknown' },
        'inbox-categorize.addLabels_unsupported — connector did not implement labels',
      );
      return {
        ok: false,
        summary: 'active email-inbox connector does not support labels — cannot categorize',
        details: { scanned: messages.length },
      };
    }
    const addLabels = inbox.addLabels.bind(inbox);

    const llm = await resolveLlm(ctx, settings.llm);
    const sys = systemPrompt(settings.categories);

    // Track everything we plan to do, grouped by category, so we can fire
    // one addLabels call per category instead of one per message.
    const idsByCategory = new Map<string, string[]>();
    let belowThreshold = 0;
    let invalidCategory = 0;
    let totalUsageInput = 0;
    let totalUsageOutput = 0;

    for (const batch of chunk(messages, CLASSIFY_BATCH)) {
      const response = await llm.complete({
        system: sys,
        messages: [{ role: 'user', content: userPromptForBatch(batch) }],
      });
      totalUsageInput += response.usage?.inputTokens ?? 0;
      totalUsageOutput += response.usage?.outputTokens ?? 0;

      let parsed: Classification;
      try {
        parsed = parseClassificationJson(response.content);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.logger.error(
          { rawHead: response.content.slice(0, 200), parseError: message },
          'inbox-categorize.parse_failed',
        );
        return {
          ok: false,
          summary: `model returned unparseable output: ${message}`,
          details: { stopReason: response.stopReason },
        };
      }

      for (const c of parsed.classifications) {
        if (!allowedCategories.has(c.category)) {
          invalidCategory += 1;
          continue;
        }
        if (c.confidence < settings.confidenceThreshold) {
          belowThreshold += 1;
          continue;
        }
        let list = idsByCategory.get(c.category);
        if (!list) {
          list = [];
          idsByCategory.set(c.category, list);
        }
        list.push(c.id);
      }
    }

    let applied = 0;
    for (const [category, ids] of idsByCategory) {
      await addLabels(ids, [category]);
      applied += ids.length;
      await ctx.audit('inbox.categorize.applied', {
        category,
        count: ids.length,
      });
    }

    return {
      ok: true,
      summary: `categorized ${applied} / ${messages.length} messages above threshold; ${belowThreshold} below threshold left alone`,
      details: {
        scanned: messages.length,
        applied,
        belowThreshold,
        invalidCategory,
        categoryCounts: Object.fromEntries(
          Array.from(idsByCategory, ([k, v]) => [k, v.length]),
        ),
        usage: { inputTokens: totalUsageInput, outputTokens: totalUsageOutput },
      },
    };
  },
});

export { InputSchema, SettingsSchema };
