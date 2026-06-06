import { z } from 'zod';
import OpenAI from 'openai';
import {
  defineConnector,
  type ConnectorContext,
  type LlmCapability,
  type LlmRequest,
  type LlmResponse,
  type LlmStreamChunk,
} from '@business-os/connector-sdk';

/**
 * OpenAI provider for the `llm` capability.
 *
 * Uses the Chat Completions API. The "messages" shape matches Anthropic's
 * closely enough that the framework's LlmRequest covers both providers
 * cleanly — only the per-provider quirks (system message format,
 * temperature handling, stop_reason vocabulary) live here.
 *
 * Defaults to gpt-4o; operators override per-agent via the settings UI
 * + LlmPicker convention. Optional `baseUrl` lets the connector target
 * OpenAI-compatible gateways (Azure OpenAI, vLLM, Together, etc.).
 */

const settingsSchema = z.object({
  defaultModel: z.string().default('gpt-4o'),
  defaultMaxTokens: z.number().int().positive().default(4_096),
  systemPrefix: z.string().optional(),
  baseUrl: z.string().url().optional(),
});

type Settings = z.infer<typeof settingsSchema>;

function buildClient(ctx: ConnectorContext<Settings>): OpenAI {
  if (ctx.credentials.kind !== 'api-key') {
    throw new Error(
      `connector-openai requires api-key credentials, got "${ctx.credentials.kind}"`,
    );
  }
  return new OpenAI({
    apiKey: ctx.credentials.key,
    baseURL: ctx.settings.baseUrl,
  });
}

function joinSystem(prefix: string | undefined, perReq: string | undefined): string | undefined {
  if (prefix && perReq) return `${prefix}\n\n${perReq}`;
  return prefix ?? perReq;
}

function mapStopReason(finish: string | null | undefined): LlmResponse['stopReason'] {
  switch (finish) {
    case 'stop':
      return 'end';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
      return 'tool_use';
    default:
      return 'other';
  }
}

function buildMessages(
  system: string | undefined,
  reqMessages: LlmRequest['messages'],
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of reqMessages) out.push({ role: m.role, content: m.content });
  return out;
}

function makeLlm(ctx: ConnectorContext<Settings>): LlmCapability {
  const client = buildClient(ctx);

  const buildParamsCommon = (req: LlmRequest): { model: string; max_tokens: number; messages: ReturnType<typeof buildMessages>; temperature?: number } => {
    const model = req.model ?? ctx.settings.defaultModel;
    const maxTokens = req.maxTokens ?? ctx.settings.defaultMaxTokens;
    const system = joinSystem(ctx.settings.systemPrefix, req.system);
    return {
      model,
      max_tokens: maxTokens,
      messages: buildMessages(system, req.messages),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };
  };

  return {
    async complete(req): Promise<LlmResponse> {
      const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        ...buildParamsCommon(req),
        stream: false,
      };
      const response = await client.chat.completions.create(params);
      const choice = response.choices[0];
      const content = choice?.message?.content ?? '';
      ctx.logger.info(
        {
          model: response.model,
          input_tokens: response.usage?.prompt_tokens ?? 0,
          output_tokens: response.usage?.completion_tokens ?? 0,
          finish_reason: choice?.finish_reason,
        },
        'openai.complete',
      );
      return {
        content,
        stopReason: mapStopReason(choice?.finish_reason),
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
      };
    },

    async *stream(req): AsyncIterable<LlmStreamChunk> {
      const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
        ...buildParamsCommon(req),
        stream: true,
      };
      const stream = await client.chat.completions.create(params);
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) yield { delta, done: false };
      }
      yield { delta: '', done: true };
    },
  };
}

export const manifest = {
  slug: 'openai',
  capability: 'llm' as const,
  version: '0.0.1',
  displayName: 'OpenAI',
  authKind: 'api-key' as const,
  settingsSchema,
};

export default defineConnector({
  manifest,
  factory: (ctx) => makeLlm(ctx as ConnectorContext<Settings>),
});
