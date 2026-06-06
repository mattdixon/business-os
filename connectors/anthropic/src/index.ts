import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import {
  defineConnector,
  type ConnectorContext,
  type LlmCapability,
  type LlmRequest,
  type LlmResponse,
  type LlmStreamChunk,
} from '@business-os/connector-sdk';

/**
 * Anthropic provider for the `llm` capability.
 *
 * Defaults to `claude-opus-4-7` — the most capable model at time of build.
 * Per the Opus 4.7 contract: `temperature` / `top_p` / `top_k` and the
 * legacy `budget_tokens` thinking field will 400, so we drop them on that
 * model family. Other models keep `temperature` when provided.
 *
 * The operator configures this connector via the framework settings UI:
 *   - secret: Anthropic API key (encrypted at rest via @business-os/core/secrets)
 *   - settings: default model, default max_tokens, optional system prefix
 */

const settingsSchema = z.object({
  /** Default model ID. Override per-request via LlmRequest.model. */
  defaultModel: z.string().default('claude-opus-4-7'),
  /** Default max_tokens. Override per-request. */
  defaultMaxTokens: z.number().int().positive().default(16_000),
  /** Optional system prefix prepended to every request's system prompt. */
  systemPrefix: z.string().optional(),
  /** Override Anthropic API base URL — useful for tests. */
  baseUrl: z.string().url().optional(),
});

type Settings = z.infer<typeof settingsSchema>;

/** Models on which sampling params + extended-thinking budget_tokens 400. */
function isOpusFortySeven(model: string): boolean {
  return model.startsWith('claude-opus-4-7');
}

function mapStopReason(
  reason: string | null | undefined,
): LlmResponse['stopReason'] {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'max_tokens':
      return 'max_tokens';
    case 'tool_use':
      return 'tool_use';
    default:
      return 'other';
  }
}

function buildClient(ctx: ConnectorContext<Settings>): Anthropic {
  if (ctx.credentials.kind !== 'api-key') {
    throw new Error(
      `connector-anthropic requires api-key credentials, got "${ctx.credentials.kind}"`,
    );
  }
  return new Anthropic({
    apiKey: ctx.credentials.key,
    baseURL: ctx.settings.baseUrl,
  });
}

function joinSystem(
  prefix: string | undefined,
  perReq: string | undefined,
): string | undefined {
  if (prefix && perReq) return `${prefix}\n\n${perReq}`;
  return prefix ?? perReq;
}

function makeLlm(ctx: ConnectorContext<Settings>): LlmCapability {
  const client = buildClient(ctx);

  const buildParams = (
    req: LlmRequest,
  ): Anthropic.Messages.MessageCreateParamsNonStreaming => {
    const model = req.model ?? ctx.settings.defaultModel;
    const maxTokens = req.maxTokens ?? ctx.settings.defaultMaxTokens;
    const system = joinSystem(ctx.settings.systemPrefix, req.system);

    const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: maxTokens,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
    if (system) params.system = system;
    if (req.temperature !== undefined && !isOpusFortySeven(model)) {
      params.temperature = req.temperature;
    }
    return params;
  };

  return {
    async complete(req) {
      const response = await client.messages.create(buildParams(req));
      const textBlock = response.content.find(
        (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
      );
      ctx.logger.info(
        {
          model: response.model,
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          stop_reason: response.stop_reason,
        },
        'anthropic.complete',
      );
      return {
        content: textBlock?.text ?? '',
        stopReason: mapStopReason(response.stop_reason),
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },

    async *stream(req): AsyncIterable<LlmStreamChunk> {
      const stream = client.messages.stream(buildParams(req));
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { delta: event.delta.text, done: false };
        }
      }
      yield { delta: '', done: true };
    },
  };
}

export const manifest = {
  slug: 'anthropic',
  capability: 'llm' as const,
  version: '0.0.1',
  displayName: 'Anthropic (Claude)',
  authKind: 'api-key' as const,
  settingsSchema,
};

export default defineConnector({
  manifest,
  factory: (ctx) => makeLlm(ctx as ConnectorContext<Settings>),
});
