import { describe, it, expect, vi, beforeEach } from 'vitest';
import connector, { manifest } from '../src/index.js';

const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class FakeAnthropic {
      messages = { create: createMock };
      constructor(public opts: unknown) {}
    },
  };
});

const noopLogger = {
  info: (_o: object | string, _m?: string) => {},
  warn: (_o: object | string, _m?: string) => {},
  error: (_o: object | string, _m?: string) => {},
};

function buildCtx(overrides: Partial<{ model: string }> = {}) {
  const parsed = manifest.settingsSchema.parse({
    defaultModel: overrides.model ?? 'claude-opus-4-7',
  });
  return {
    credentials: { kind: 'api-key' as const, key: 'sk-test' },
    settings: parsed,
    logger: noopLogger,
  };
}

describe('connector-anthropic', () => {
  beforeEach(() => createMock.mockReset());

  it('manifest declares the llm capability + api-key auth', () => {
    expect(manifest.slug).toBe('anthropic');
    expect(manifest.capability).toBe('llm');
    expect(manifest.authKind).toBe('api-key');
  });

  it('complete() maps Anthropic response into LlmResponse', async () => {
    createMock.mockResolvedValueOnce({
      model: 'claude-opus-4-7',
      content: [{ type: 'text', text: 'hello back' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 7 },
    });
    const llm = connector.factory(buildCtx());
    const out = await llm.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(out).toEqual({
      content: 'hello back',
      stopReason: 'end',
      usage: { inputTokens: 12, outputTokens: 7 },
    });
    expect(createMock).toHaveBeenCalledOnce();
  });

  it('drops temperature on Opus 4.7', async () => {
    createMock.mockResolvedValueOnce({
      model: 'claude-opus-4-7',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const llm = connector.factory(buildCtx({ model: 'claude-opus-4-7' }));
    await llm.complete({
      messages: [{ role: 'user', content: 'x' }],
      temperature: 0.7,
    });
    const call = createMock.mock.calls[0]![0];
    expect(call.temperature).toBeUndefined();
  });

  it('passes temperature through on non-4.7 models', async () => {
    createMock.mockResolvedValueOnce({
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const llm = connector.factory(buildCtx({ model: 'claude-sonnet-4-6' }));
    await llm.complete({
      messages: [{ role: 'user', content: 'x' }],
      temperature: 0.5,
    });
    const call = createMock.mock.calls[0]![0];
    expect(call.temperature).toBe(0.5);
  });

  it('joins systemPrefix with per-request system prompt', async () => {
    createMock.mockResolvedValueOnce({
      model: 'claude-opus-4-7',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ctx = buildCtx();
    ctx.settings = manifest.settingsSchema.parse({
      defaultModel: 'claude-opus-4-7',
      systemPrefix: 'You are an agent in Business OS.',
    });
    const llm = connector.factory(ctx);
    await llm.complete({
      system: 'Be concise.',
      messages: [{ role: 'user', content: 'x' }],
    });
    const call = createMock.mock.calls[0]![0];
    expect(call.system).toBe('You are an agent in Business OS.\n\nBe concise.');
  });

  it('maps stop_reason: max_tokens', async () => {
    createMock.mockResolvedValueOnce({
      model: 'claude-opus-4-7',
      content: [{ type: 'text', text: 'partial' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 5, output_tokens: 20 },
    });
    const llm = connector.factory(buildCtx());
    const out = await llm.complete({
      messages: [{ role: 'user', content: 'long' }],
    });
    expect(out.stopReason).toBe('max_tokens');
  });

  it('rejects non api-key credentials at factory time', () => {
    const ctx = buildCtx();
    (ctx as { credentials: unknown }).credentials = { kind: 'oauth2', accessToken: 'x' };
    expect(() => connector.factory(ctx as never)).toThrow(/api-key/);
  });
});
