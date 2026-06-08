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
  email: EmailCapability;
  crm: CrmCapability;
  llm: LlmCapability;
  'file-storage': FileStorageCapability;
}

// -----------------------------------------------------------------------------
// Capability interfaces
// -----------------------------------------------------------------------------

export interface EmailCapability {
  send(msg: OutboundEmail): Promise<{ messageId: string }>;
  listInbox?(opts: ListInboxOpts): Promise<InboundEmail[]>;
  getMessage?(id: string): Promise<InboundEmail>;
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

export type ConnectorAuthKind = 'oauth2' | 'api-key' | 'none';

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
