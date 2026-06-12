import { describe, it, expect, vi } from 'vitest';
import { LlmPickerSchema, resolveLlm } from '../src/llm-picker.js';
import type { LlmCapability, LlmRequest } from '@frontrangesystems/business-os-connector-sdk';

function fakeLlm(): LlmCapability & { _last: LlmRequest | null } {
  const obj: LlmCapability & { _last: LlmRequest | null } = {
    _last: null,
    async complete(req) {
      obj._last = req;
      return {
        content: 'ok',
        stopReason: 'end',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
  return obj;
}

describe('LlmPickerSchema', () => {
  it('parses an empty object as fully optional', () => {
    const parsed = LlmPickerSchema.parse({});
    expect(parsed).toEqual({});
  });

  it('accepts providerSlug + model + maxTokens + temperature', () => {
    const parsed = LlmPickerSchema.parse({
      providerSlug: 'openai',
      model: 'o-1',
      maxTokens: 1024,
      temperature: 0.2,
    });
    expect(parsed.providerSlug).toBe('openai');
    expect(parsed.model).toBe('o-1');
    expect(parsed.maxTokens).toBe(1024);
    expect(parsed.temperature).toBe(0.2);
  });

  it('rejects invalid types', () => {
    expect(() => LlmPickerSchema.parse({ providerSlug: '' })).toThrow();
    expect(() => LlmPickerSchema.parse({ maxTokens: -1 })).toThrow();
    expect(() => LlmPickerSchema.parse({ temperature: 5 })).toThrow();
  });
});

describe('resolveLlm', () => {
  function buildCtx(llm: LlmCapability) {
    const connector = vi.fn(async () => llm);
    return {
      ctx: {
        settings: {},
        logger: {
          trace: () => {}, debug: () => {}, info: () => {},
          warn: () => {}, error: () => {},
        },
        connector,
        db: {},
        audit: async () => {},
        jobs: { enqueue: async () => 'job-id' },
        runId: 'run-1',
      },
      connector,
    };
  }

  it('forwards providerSlug to ctx.connector', async () => {
    const llm = fakeLlm();
    const { ctx, connector } = buildCtx(llm);
    await resolveLlm(ctx as never, { providerSlug: 'openai' });
    expect(connector).toHaveBeenCalledWith('llm', { providerSlug: 'openai' });
  });

  it('injects picker defaults (model/maxTokens/temperature) into complete()', async () => {
    const llm = fakeLlm();
    const { ctx } = buildCtx(llm);
    const wrapped = await resolveLlm(ctx as never, {
      providerSlug: 'anthropic',
      model: 'claude-sonnet-4-6',
      maxTokens: 2048,
      temperature: 0.4,
    });
    await wrapped.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(llm._last).toMatchObject({
      model: 'claude-sonnet-4-6',
      maxTokens: 2048,
      temperature: 0.4,
    });
  });

  it('call-site overrides win over picker defaults', async () => {
    const llm = fakeLlm();
    const { ctx } = buildCtx(llm);
    const wrapped = await resolveLlm(ctx as never, {
      model: 'claude-sonnet-4-6',
      temperature: 0.4,
    });
    await wrapped.complete({
      model: 'claude-opus-4-7',
      temperature: 0.9,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(llm._last).toMatchObject({
      model: 'claude-opus-4-7',
      temperature: 0.9,
    });
  });

  it('with no picker, leaves request fields untouched and uses active provider', async () => {
    const llm = fakeLlm();
    const { ctx, connector } = buildCtx(llm);
    const wrapped = await resolveLlm(ctx as never, undefined);
    expect(connector).toHaveBeenCalledWith('llm', { providerSlug: undefined });
    await wrapped.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(llm._last?.model).toBeUndefined();
    expect(llm._last?.maxTokens).toBeUndefined();
  });
});
