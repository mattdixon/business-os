import type { z } from 'zod';

/**
 * Capability registry — the stable contract agents code against.
 *
 * Agents ask `ctx.connector('email')` and get back something that satisfies
 * EmailCapability. The active provider (Gmail, Outlook, Resend, ...) is
 * chosen by the operator in the settings UI.
 *
 * To add a new capability: add a field here, define its interface below.
 * To add a new provider for an existing capability: ship a connector package
 *   whose impl satisfies the capability interface.
 */
export interface ConnectorCapabilityMap {
  /** Outbound send. Resend, Postmark, Gmail-send, Outlook-send. */
  email: EmailCapability;
  /**
   * Inbound + manipulation: list, label, archive, delete, search. Gmail
   * via Composio, Outlook via Composio, IMAP direct. Distinct from
   * `email` (send) so agents that only need send don't depend on an
   * inbox-capable provider, and vice versa.
   */
  'email-inbox': EmailInboxCapability;
  crm: CrmCapability;
  llm: LlmCapability;
  'file-storage': FileStorageCapability;
}

// -----------------------------------------------------------------------------
// Capability interfaces
// -----------------------------------------------------------------------------

export interface EmailCapability {
  send(msg: OutboundEmail): Promise<{ messageId: string }>;
  /**
   * @deprecated Use the `email-inbox` capability instead. Kept on the
   * interface for transitional reasons; will be removed in a future
   * breaking change. New connectors SHOULD NOT implement these.
   */
  listInbox?(opts: ListInboxOpts): Promise<InboundEmail[]>;
  /** @deprecated See listInbox. */
  getMessage?(id: string): Promise<InboundEmail>;
}

// -----------------------------------------------------------------------------
// email-inbox — distinct from outbound `email`
// -----------------------------------------------------------------------------

export interface EmailInboxCapability {
  /**
   * List messages matching the given query. Implementations MUST honor
   * `pageSize` (default 50, max 200). Returns a stable cursor that may be
   * passed back in `opts.cursor` for the next page.
   */
  listMessages(opts: ListMessagesOpts): Promise<ListMessagesResult>;

  /** Fetch a single message including its full body. */
  getMessage(id: string): Promise<InboxMessage>;

  /** Mark one or more messages read/unread. */
  markRead(ids: string[]): Promise<void>;
  markUnread(ids: string[]): Promise<void>;

  /**
   * Move messages out of the inbox without deleting. Gmail = remove
   * `INBOX` label. Outlook = move to Archive folder. IMAP = move to the
   * configured archive folder.
   */
  archive(ids: string[]): Promise<void>;

  /**
   * Soft-delete. Gmail = move to Trash. Outlook = move to Deleted Items.
   * IMAP = move to the configured trash folder.
   */
  trash(ids: string[]): Promise<void>;

  /**
   * Permanent delete. Gmail/Outlook = purge from trash. IMAP = expunge
   * from trash folder. Use with care — there is no undo.
   */
  deletePermanently(ids: string[]): Promise<void>;

  /**
   * Add or remove a label/category/folder tag.
   *   Gmail: applies a label (creating it if needed).
   *   Outlook: applies a category (creating it if needed).
   *   IMAP: out-of-band — see provider docs (likely a no-op or move).
   */
  addLabels?(ids: string[], labels: string[]): Promise<void>;
  removeLabels?(ids: string[], labels: string[]): Promise<void>;

  /** List the user's labels/categories/folders. */
  listLabels?(): Promise<InboxLabel[]>;

  /**
   * Provider-native search. The query string is passed through verbatim,
   * so agents that build queries MUST be aware of the active provider's
   * syntax (Gmail: `from:foo is:unread`; Outlook: KQL; IMAP: SEARCH).
   * Prefer structured fields on `opts` when possible.
   */
  search(query: string, opts?: SearchOpts): Promise<ListMessagesResult>;
}

export interface ListMessagesOpts {
  /** Restrict to messages received on or after this instant. */
  since?: Date;
  /** Restrict to messages received on or before this instant. */
  until?: Date;
  /** Only unread. */
  unreadOnly?: boolean;
  /** Restrict to a specific label/category/folder. */
  labelId?: string;
  /** Max messages per page. Default 50, hard cap 200. */
  pageSize?: number;
  /** Opaque continuation token from a prior result. */
  cursor?: string;
}

export interface ListMessagesResult {
  messages: InboxMessageSummary[];
  /** Opaque token to pass back as opts.cursor. Null when no more pages. */
  nextCursor: string | null;
}

export interface SearchOpts {
  pageSize?: number;
  cursor?: string;
}

/**
 * Light shape returned by list endpoints — keep small so bulk listing
 * stays cheap. Call getMessage for the full body.
 */
export interface InboxMessageSummary {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  /** First N chars of the body, plain text. Implementation-defined N. */
  snippet: string;
  receivedAt: Date;
  unread: boolean;
  labels: string[];
}

export interface InboxMessage extends InboxMessageSummary {
  text: string;
  html?: string;
  headers?: Record<string, string>;
}

export interface InboxLabel {
  id: string;
  name: string;
  /** Whether the user (vs system) created this label. */
  isUserDefined: boolean;
}

export interface OutboundEmail {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  threadId?: string;
}

export interface InboundEmail {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  receivedAt: Date;
}

export interface ListInboxOpts {
  since?: Date;
  unreadOnly?: boolean;
  limit?: number;
}

export interface CrmCapability {
  upsertContact(c: CrmContact): Promise<{ id: string }>;
  findContactByEmail(email: string): Promise<CrmContact | null>;
  addTag(contactId: string, tag: string): Promise<void>;
  addNote(contactId: string, note: string): Promise<void>;
  createTask(contactId: string, task: CrmTask): Promise<{ id: string }>;
}

export interface CrmContact {
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  company?: string;
  customFields?: Record<string, string | number | boolean>;
}

export interface CrmTask {
  title: string;
  body?: string;
  dueAt?: Date;
}

export interface LlmCapability {
  complete(req: LlmRequest): Promise<LlmResponse>;
  /** Optional streaming — connectors may omit. */
  stream?(req: LlmRequest): AsyncIterable<LlmStreamChunk>;
}

export interface LlmRequest {
  model?: string; // connector picks a default if omitted
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
  jsonSchema?: unknown; // structured output
}

export interface LlmResponse {
  content: string;
  stopReason: 'end' | 'max_tokens' | 'tool_use' | 'other';
  usage: { inputTokens: number; outputTokens: number };
}

export interface LlmStreamChunk {
  delta: string;
  done: boolean;
}

export interface FileStorageCapability {
  put(key: string, body: Uint8Array, contentType?: string): Promise<{ url: string }>;
  get(key: string): Promise<Uint8Array>;
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}

// -----------------------------------------------------------------------------
// Connector package shape
// -----------------------------------------------------------------------------

export type ConnectorAuthKind = 'oauth2' | 'api-key' | 'none' | 'custom';

export interface ConnectorManifest<TSettings extends z.ZodTypeAny = z.ZodTypeAny> {
  slug: string;
  capability: keyof ConnectorCapabilityMap;
  version: string;
  displayName: string;
  authKind: ConnectorAuthKind;
  /** OAuth2 metadata — present when authKind === 'oauth2' */
  oauth2?: {
    authorizationUrl: string;
    tokenUrl: string;
    scopes: string[];
  };
  /**
   * Marks the connector as using an external OAuth broker (e.g. Composio).
   * The framework's "Connect" flow uses this metadata to drive the dance:
   * authKind stays 'api-key' (the operator-facing credential is the broker's
   * API key + the per-account user_id), but the framework knows to call the
   * broker's link/callback flow instead of presenting a paste-the-key form.
   */
  externalOAuth?: {
    provider: 'composio';
    /** Provider's toolkit slug, e.g. 'gmail', 'outlook', 'jira'. */
    toolkit: string;
  };
  /** Zod schema for connector-instance settings (non-secret config) */
  settingsSchema: TSettings;
  /**
   * Optional Zod schema describing custom credential fields. Set when
   * `authKind === 'custom'` (e.g. IMAP needs user + password, not a single
   * API key). The framework auto-renders these fields in the Add form and
   * stores values as `{ kind: 'custom', values: {...} }`.
   *
   * Mark a field as a masked secret by prefixing its description with
   * `secret: ` — `z.string().describe('secret: IMAP password')`.
   */
  credentialsSchema?: z.ZodTypeAny;
}

/**
 * What the framework hands a connector when it instantiates it.
 * Connectors NEVER reach into the framework directly — only through ctx.
 */
export interface ConnectorContext<TSettings = unknown> {
  /** Decrypted credentials (OAuth token bundle, API key, etc.) */
  credentials: ConnectorCredentials;
  /** Decrypted, parsed settings */
  settings: TSettings;
  logger: {
    info(obj: object | string, msg?: string): void;
    warn(obj: object | string, msg?: string): void;
    error(obj: object | string, msg?: string): void;
  };
  /** Helper to refresh OAuth tokens — framework persists the result */
  refreshOAuth?(newCreds: ConnectorCredentials): Promise<void>;
}

export type ConnectorCredentials =
  | { kind: 'oauth2'; accessToken: string; refreshToken?: string; expiresAt?: Date }
  | { kind: 'api-key'; key: string; extra?: Record<string, string> }
  | { kind: 'custom'; values: Record<string, string> }
  | { kind: 'none' };

/**
 * A connector package exports `manifest` and a `factory` that returns the
 * capability impl, scoped to a particular operator-configured instance.
 */
export interface ConnectorPackage<
  C extends keyof ConnectorCapabilityMap,
  TSettings extends z.ZodTypeAny = z.ZodTypeAny,
> {
  manifest: ConnectorManifest<TSettings>;
  factory(ctx: ConnectorContext<z.infer<TSettings>>): ConnectorCapabilityMap[C];
  /**
   * Optional "is this connector reachable?" hook. The operator UI calls it
   * via POST /api/connectors/:id/test. Implementations SHOULD hit the
   * cheapest endpoint the provider exposes that requires authentication —
   * e.g. listing models (Anthropic + OpenAI), a Composio ping, or a
   * 0-byte HEAD against a known URL. They MUST NOT consume billable
   * tokens or perform side-effects. Throw on failure with a human-
   * readable message; the framework surfaces it in the UI.
   */
  verify?(ctx: ConnectorContext<z.infer<TSettings>>): Promise<void>;
}

export function defineConnector<
  C extends keyof ConnectorCapabilityMap,
  TSettings extends z.ZodTypeAny,
>(pkg: ConnectorPackage<C, TSettings>): ConnectorPackage<C, TSettings> {
  return pkg;
}

// -----------------------------------------------------------------------------
// External OAuth broker — interface implemented by connector packages that
// front an integration platform (Composio, Nango, Pipedream Connect, ...).
// Defined here so @business-os/core can drive the Connect-flow against any
// broker without taking a direct dependency on a connector package.
//
// The client shell constructs the concrete broker (with API key etc.) and
// passes it into startServer({ externalOAuthBrokers: { composio: substrate } }).
// -----------------------------------------------------------------------------

export interface ExternalOAuthBroker {
  /**
   * Resolve a broker auth config for `toolkit`, creating one if none exists.
   * Returns an opaque id the broker uses to identify which OAuth app to
   * present on the consent screen.
   */
  findOrCreateManagedAuthConfig(toolkit: string): Promise<{ id: string; toolkit: string }>;
  /**
   * Initiate a connection for `userId`. Returns the URL the operator's
   * browser must visit to grant access.
   */
  createConnectionLink(p: {
    userId: string;
    authConfigId: string;
    callbackUrl: string;
  }): Promise<{ connectionRequestId: string; redirectUrl: string }>;
  /**
   * Look up the active connected-account id for (userId, toolkit), or null
   * if the operator hasn't finished consenting yet. Polled by the framework
   * after the operator returns from the consent screen.
   */
  getActiveConnection(userId: string, toolkit: string): Promise<string | null>;
}
