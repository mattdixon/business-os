import { z } from 'zod';
import type { AgentContext } from './index.js';
import type {
  LlmCapability,
  LlmRequest,
  LlmResponse,
} from '@frontrangesystems/business-os-connector-sdk';

/**
 * Per-agent LLM picker.
 *
 * Convention: any agent that wants the operator to be able to choose the
 * LLM provider AND model from its settings UI extends its settingsSchema
 * with `llm: LlmPickerSchema` and uses `resolveLlm(ctx, settings.llm)` to
 * get a wrapped capability that defaults to the picked provider+model.
 *
 * This keeps "which provider, which model" out of agent code and in the
 * operator's hands — per-agent. Matt: "Any agent should be able to run
 * any AI platform with any model. Configurable per agent."
 */

export const LlmPickerSchema = z.object({
  /**
   * Connector provider slug, e.g. "anthropic" or "openai".
   * Omit to use whichever provider the operator marked active globally.
   */
  providerSlug: z.string().min(1).optional(),
  /**
   * Model ID, passed through to the provider on every complete()/stream() call.
   * Omit to let the provider's own settings default to its model.
   */
  model: z.string().min(1).optional(),
  /**
   * Optional override of max_tokens for this agent. Falls back to the
   * connector's `defaultMaxTokens` if omitted.
   */
  maxTokens: z.number().int().positive().optional(),
  /**
   * Optional override of temperature. The provider connector decides whether
   * to honor it (e.g. Anthropic drops temperature on Opus 4.7).
   */
  temperature: z.number().min(0).max(2).optional(),
});

export type LlmPicker = z.infer<typeof LlmPickerSchema>;

/**
 * Resolves the LLM capability per the agent's picker settings and returns
 * a thin wrapper that injects the operator-chosen model + maxTokens +
 * temperature into every request unless the call site overrides them.
 */
export async function resolveLlm(
  ctx: AgentContext,
  picker: LlmPicker | undefined,
): Promise<LlmCapability> {
  const llm = (await ctx.connector('llm', {
    providerSlug: picker?.providerSlug,
  })) as LlmCapability;

  const withDefaults = (req: LlmRequest): LlmRequest => ({
    ...req,
    model: req.model ?? picker?.model,
    maxTokens: req.maxTokens ?? picker?.maxTokens,
    temperature: req.temperature ?? picker?.temperature,
  });

  return {
    complete: (req): Promise<LlmResponse> => llm.complete(withDefaults(req)),
    stream: llm.stream
      ? (req) => llm.stream!(withDefaults(req))
      : undefined,
  };
}
