import { describe, it, expect, vi, beforeEach } from 'vitest';
import connector, { manifest } from '../src/index.js';

const createMock = vi.fn();

vi.mock('openai', () => {
  return {
    default: class FakeOpenAI {
      chat = { completions: { create: createMock } };
      constructor(public opts: unknown) {}
    },
  };
});

const noopLogger = {
  info: (_o: object | string, _m?: string) => {},
  warn: (_o: object | string, _m?: string) => {},
  error: (_o: object | string, _m?: string) => {},
};

function buildCtx(overrides: { model?: string; systemPrefix?: string } = {}) {
  const parsed = manifest.settingsSchema.parse({
    defaultModel: overrides.model ?? 'gpt-4o',
    systemPrefix: overrides.systemPrefix,
  });
  return {
    credentials: { kind: 'api-key' as const, key: 'sk-test' },
    settings: parsed,
    logger: noopLogger,
  };
}

describe('connector-openai', () => {
  beforeEach(() => createMock.mockReset());

  it('manifest declares the llm capability + api-key auth', () => {
    expect(manifest.slug).toBe('openai');
    expect(manifest.capability).toBe('llm');
    expect(manifest.authKind).toBe('api-key');
  });

  it('complete() maps OpenAI response into LlmResponse', async () => {
    createMock.mockResolvedValueOnce({
      model: 'gpt-4o',
      choices: [{ message: { content: 'hello back' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 7 },
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
  });

  it('passes temperature through unmodified', async () => {
    createMock.mockResolvedValueOnce({
      model: 'gpt-4o',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const llm = connector.factory(buildCtx());
    await llm.complete({
      messages: [{ role: 'user', content: 'x' }],
      temperature: 0.7,
    });
    const call = createMock.mock.calls[0]![0];
    expect(call.temperature).toBe(0.7);
  });

  it('injects system as the first message and joins systemPrefix', async () => {
    createMock.mockResolvedValueOnce({
      model: 'gpt-4o',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const llm = connector.factory(buildCtx({ systemPrefix: 'I am operator-wide context.' }));
    await llm.complete({
      system: 'Be concise.',
      messages: [{ role: 'user', content: 'x' }],
    });
    const call = createMock.mock.calls[0]![0];
    expect(call.messages[0]).toEqual({
      role: 'system',
      content: 'I am operator-wide context.\n\nBe concise.',
    });
    expect(call.messages[1]).toEqual({ role: 'user', content: 'x' });
  });

  it('maps finish_reason: length → max_tokens', async () => {
    createMock.mockResolvedValueOnce({
      model: 'gpt-4o',
      choices: [{ message: { content: 'partial' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 5, completion_tokens: 20 },
    });
    const llm = connector.factory(buildCtx());
    const out = await llm.complete({
      messages: [{ role: 'user', content: 'long' }],
    });
    expect(out.stopReason).toBe('max_tokens');
  });

  it('handles missing usage block (e.g. via custom baseUrl gateways)', async () => {
    createMock.mockResolvedValueOnce({
      model: 'gpt-4o',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      // no usage field
    });
    const llm = connector.factory(buildCtx());
    const out = await llm.complete({
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(out.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('rejects non api-key credentials at factory time', () => {
    const ctx = buildCtx();
    (ctx as { credentials: unknown }).credentials = { kind: 'oauth2', accessToken: 'x' };
    expect(() => connector.factory(ctx as never)).toThrow(/api-key/);
  });
});
