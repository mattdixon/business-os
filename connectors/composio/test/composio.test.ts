import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listAuthConfigs, createAuthConfig, linkConn, listConn, executeTool, FakeComposioError } =
  vi.hoisted(() => {
    const fns = {
      listAuthConfigs: vi.fn(),
      createAuthConfig: vi.fn(),
      linkConn: vi.fn(),
      listConn: vi.fn(),
      executeTool: vi.fn(),
    };
    class FakeComposioError extends Error {
      constructor(public name_: string, msg: string, public cause_?: { status?: number }) {
        super(msg);
        this.name = name_;
        if (cause_) (this as { cause?: unknown }).cause = cause_;
      }
    }
    return { ...fns, FakeComposioError };
  });

vi.mock('@composio/core', () => ({
  Composio: class {
    constructor(public opts: { apiKey: string; toolkitVersions?: Record<string, string> }) {}
    authConfigs = { list: listAuthConfigs, create: createAuthConfig };
    connectedAccounts = { link: linkConn, list: listConn };
    tools = { execute: executeTool };
  },
  ComposioError: FakeComposioError,
}));

import {
  ComposioSubstrate,
  ComposioSubstrateError,
  DEFAULT_TOOLKIT_VERSIONS,
} from '../src/index.js';

describe('ComposioSubstrate', () => {
  beforeEach(() => {
    listAuthConfigs.mockReset();
    createAuthConfig.mockReset();
    linkConn.mockReset();
    listConn.mockReset();
    executeTool.mockReset();
  });

  it('requires an apiKey', () => {
    expect(() => new ComposioSubstrate({ apiKey: '' })).toThrow(/apiKey/);
  });

  it('merges per-toolkit version overrides with defaults', () => {
    const s = new ComposioSubstrate({
      apiKey: 'k',
      toolkitVersions: { jira: '20260101_00' },
    });
    // Inspect via private client opts — substrate stores it on the fake.
    const opts = (s as unknown as { client: { opts: { toolkitVersions: Record<string, string> } } })
      .client.opts;
    expect(opts.toolkitVersions).toEqual({
      ...DEFAULT_TOOLKIT_VERSIONS,
      jira: '20260101_00',
    });
  });

  it('findOrCreateManagedAuthConfig reuses an existing config', async () => {
    listAuthConfigs.mockResolvedValueOnce({ items: [{ id: 'ac_existing' }] });
    const s = new ComposioSubstrate({ apiKey: 'k' });
    const out = await s.findOrCreateManagedAuthConfig('gmail');
    expect(out).toEqual({ id: 'ac_existing', toolkit: 'gmail' });
    expect(createAuthConfig).not.toHaveBeenCalled();
  });

  it('findOrCreateManagedAuthConfig creates one when none exists', async () => {
    listAuthConfigs.mockResolvedValueOnce({ items: [] });
    createAuthConfig.mockResolvedValueOnce({ id: 'ac_new' });
    const s = new ComposioSubstrate({ apiKey: 'k' });
    const out = await s.findOrCreateManagedAuthConfig('gmail');
    expect(out).toEqual({ id: 'ac_new', toolkit: 'gmail' });
    expect(createAuthConfig).toHaveBeenCalledWith('gmail', {
      type: 'use_composio_managed_auth',
      name: 'business-os-gmail',
    });
  });

  it('createConnectionLink returns redirect + request id', async () => {
    linkConn.mockResolvedValueOnce({ id: 'cr_1', redirectUrl: 'https://composio/lk_xx' });
    const s = new ComposioSubstrate({ apiKey: 'k' });
    const out = await s.createConnectionLink({
      userId: 'u',
      authConfigId: 'ac_1',
      callbackUrl: 'https://app/cb',
    });
    expect(out).toEqual({ connectionRequestId: 'cr_1', redirectUrl: 'https://composio/lk_xx' });
    expect(linkConn).toHaveBeenCalledWith('u', 'ac_1', { callbackUrl: 'https://app/cb' });
  });

  it('getActiveConnection returns the first ACTIVE account id, or null', async () => {
    listConn.mockResolvedValueOnce({ items: [{ id: 'ca_1' }] });
    const s = new ComposioSubstrate({ apiKey: 'k' });
    expect(await s.getActiveConnection('u', 'gmail')).toBe('ca_1');

    listConn.mockResolvedValueOnce({ items: [] });
    expect(await s.getActiveConnection('u', 'gmail')).toBeNull();
  });

  it('executeTool unwraps successful + data', async () => {
    executeTool.mockResolvedValueOnce({ successful: true, data: { messages: [] } });
    const s = new ComposioSubstrate({ apiKey: 'k' });
    const out = await s.executeTool({
      toolSlug: 'GMAIL_FETCH_EMAILS',
      userId: 'u',
      arguments: { max_results: 1 },
    });
    expect(out).toEqual({ successful: true, data: { messages: [] }, error: undefined });
  });

  it('maps ComposioConnectedAccountNotFoundError → kind: connection-not-found', async () => {
    executeTool.mockRejectedValueOnce(
      new FakeComposioError('ComposioConnectedAccountNotFoundError', 'no account'),
    );
    const s = new ComposioSubstrate({ apiKey: 'k' });
    await expect(
      s.executeTool({ toolSlug: 'X', userId: 'u', arguments: {} }),
    ).rejects.toMatchObject({
      name: 'ComposioSubstrateError',
      kind: 'connection-not-found',
    });
  });

  it('maps HTTP 429 cause → kind: rate-limited', async () => {
    executeTool.mockRejectedValueOnce(
      new FakeComposioError('ComposioError', 'too many requests', { status: 429 }),
    );
    const s = new ComposioSubstrate({ apiKey: 'k' });
    await expect(
      s.executeTool({ toolSlug: 'X', userId: 'u', arguments: {} }),
    ).rejects.toMatchObject({ kind: 'rate-limited' });
  });

  it('falls back to unknown for non-Composio errors', async () => {
    executeTool.mockRejectedValueOnce(new Error('boom'));
    const s = new ComposioSubstrate({ apiKey: 'k' });
    const err = await s
      .executeTool({ toolSlug: 'X', userId: 'u', arguments: {} })
      .catch((e) => e as ComposioSubstrateError);
    expect(err.kind).toBe('unknown');
    expect(err.message).toMatch(/boom/);
  });
});
