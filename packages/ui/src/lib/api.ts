/**
 * Thin fetch wrapper that talks to the framework's REST API.
 *
 * All requests are credentialed (httpOnly cookie) and JSON. Server errors
 * surface as ApiError so pages can `instanceof`-check.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  const { method = 'GET', body, signal } = opts;
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });

  let parsedBody: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsedBody = JSON.parse(text);
    } catch {
      parsedBody = text;
    }
  }

  if (!res.ok) {
    const message =
      (parsedBody && typeof parsedBody === 'object' && 'error' in parsedBody
        ? String((parsedBody as { error: unknown }).error)
        : null) ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, message, parsedBody);
  }
  return parsedBody as T;
}

// ----- Typed wrappers -----

export interface Me {
  user: { id: string; email: string } | null;
  totpEnrolled?: boolean;
}

export interface TotpEnrollResponse {
  secret: string;
  otpauthUri: string;
}

export interface AgentManifest {
  slug: string;
  version: string;
  displayName: string;
  description: string;
  requiredConnectors: string[];
  schedule: { kind: 'cron'; expr: string } | { kind: 'manual' } | { kind: 'event'; topic: string };
}

export interface AgentSummary extends AgentManifest {
  settings: unknown;
  /**
   * Discriminated-union description of the agent's settings schema, produced
   * by zodToFieldSchema on the server. Used by the UI to auto-render the
   * settings form.
   */
  settingsSchema?: unknown;
  /** Same shape as settingsSchema; only set when the agent declared an inputSchema. */
  inputSchema?: unknown | null;
  lastRun: AgentRun | null;
}

export interface AgentRun {
  id: string;
  startedAt: string;
  endedAt: string | null;
  ok: boolean | null;
  summary: string | null;
  trigger?: string;
  triggeredBy?: string | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  userId: string | null;
  userEmail: string | null;
  agentSlug: string | null;
  requestId: string | null;
  meta: Record<string, unknown> | null;
}

export interface ConnectorCapability {
  capability: string;
  providers: Array<{
    slug: string;
    displayName: string;
    authKind: 'oauth2' | 'api-key' | 'none';
    version: string;
    settingsSchema?: unknown;
  }>;
  instances: Array<{
    id: string;
    providerSlug: string;
    displayName: string;
    isActive: boolean;
    createdAt: string;
    settings?: unknown;
  }>;
}

export const Api = {
  me: () => api<Me>('/auth/me'),
  login: (email: string, password: string, totp?: string) =>
    api('/auth/login', { method: 'POST', body: { email, password, totp } }),
  logout: () => api('/auth/logout', { method: 'POST' }),

  enrollTotp: () => api<TotpEnrollResponse>('/auth/totp/enroll', { method: 'POST' }),
  confirmTotp: (code: string) =>
    api<{ ok: true }>('/auth/totp/confirm', { method: 'POST', body: { code } }),
  disableTotp: (code: string) =>
    api<{ ok: true }>('/auth/totp/disable', { method: 'POST', body: { code } }),

  listAgents: () => api<{ agents: AgentSummary[] }>('/api/agents'),
  getAgent: (slug: string) => api<AgentSummary>(`/api/agents/${slug}`),
  updateAgentSettings: (slug: string, value: unknown) =>
    api<{ ok: true; settings: unknown }>(`/api/agents/${slug}/settings`, {
      method: 'PUT',
      body: { value },
    }),
  runAgent: (slug: string, input: unknown) =>
    api<{ ok: true }>(`/api/agents/${slug}/run`, {
      method: 'POST',
      body: { input },
    }),
  listRuns: (slug: string, limit = 50) =>
    api<{ runs: AgentRun[] }>(`/api/agents/${slug}/runs?limit=${limit}`),

  listAudit: (opts: {
    limit?: number;
    action?: string;
    userId?: string;
    agentSlug?: string;
    since?: string;
  } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.action) q.set('action', opts.action);
    if (opts.userId) q.set('userId', opts.userId);
    if (opts.agentSlug) q.set('agentSlug', opts.agentSlug);
    if (opts.since) q.set('since', opts.since);
    const s = q.toString();
    return api<{ entries: AuditEntry[] }>(`/api/audit${s ? '?' + s : ''}`);
  },

  listConnectors: () => api<{ capabilities: ConnectorCapability[] }>('/api/connectors'),
  createConnector: (body: {
    capability: string;
    providerSlug: string;
    displayName: string;
  }) => api<{ instance: ConnectorCapability['instances'][number] }>(`/api/connectors`, {
    method: 'POST',
    body,
  }),
  updateConnector: (
    id: string,
    body: { displayName?: string; isActive?: boolean; settings?: unknown },
  ) =>
    api<{ instance: ConnectorCapability['instances'][number] }>(`/api/connectors/${id}`, {
      method: 'PATCH',
      body,
    }),
  setConnectorCredentials: (id: string, credentials: unknown) =>
    api<{ ok: true }>(`/api/connectors/${id}/credentials`, {
      method: 'PUT',
      body: { credentials },
    }),
  deleteConnector: (id: string) =>
    api<{ ok: true }>(`/api/connectors/${id}`, { method: 'DELETE' }),
};
