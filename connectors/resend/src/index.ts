import { z } from 'zod';
import {
  defineConnector,
  type ConnectorContext,
  type EmailCapability,
  type OutboundEmail,
} from '@business-os/connector-sdk';

/**
 * Resend provider for the `email` (send) capability.
 *
 * The operator configures via the framework settings UI:
 *   - credentials: { kind: 'api-key', key: '<re_xxxxxxxxxxxx>' }
 *   - settings: defaultFrom (required), replyTo (optional)
 *
 * Outbound calls hit POST https://api.resend.com/emails directly (no SDK
 * dep — Resend's API is small and the SDK only wraps fetch).
 */

const settingsSchema = z.object({
  /**
   * Default "from" address — Resend requires the sending domain to be
   * verified. Example: "Business OS <hello@os.example.com>".
   */
  defaultFrom: z
    .string()
    .min(1)
    .describe('Default From: address (must be a verified Resend sender).'),
  /** Default Reply-To, when the agent doesn't set one. */
  replyTo: z.string().optional().describe('Default Reply-To: address.'),
  /** Override Resend API base URL — useful for tests. */
  baseUrl: z.string().url().default('https://api.resend.com'),
});

type Settings = z.infer<typeof settingsSchema>;

interface ResendSendResponse {
  id: string;
}

interface ResendErrorResponse {
  name?: string;
  message?: string;
  statusCode?: number;
}

function requireApiKey(ctx: ConnectorContext<Settings>): string {
  if (ctx.credentials.kind !== 'api-key') {
    throw new Error(
      `connector-resend requires api-key credentials, got "${ctx.credentials.kind}"`,
    );
  }
  return ctx.credentials.key;
}

async function postEmail(
  apiKey: string,
  settings: Settings,
  msg: OutboundEmail,
): Promise<ResendSendResponse> {
  const recipients = Array.isArray(msg.to) ? msg.to : [msg.to];
  const body = {
    from: settings.defaultFrom,
    to: recipients,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    reply_to: msg.replyTo ?? settings.replyTo,
  };
  const r = await fetch(`${settings.baseUrl}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    let detail: ResendErrorResponse | null = null;
    try {
      detail = JSON.parse(text) as ResendErrorResponse;
    } catch {
      // non-JSON error body — fall through with raw text
    }
    const reason = detail?.message ?? text ?? `HTTP ${r.status}`;
    throw new Error(`resend.send failed: ${reason}`);
  }
  return (await r.json()) as ResendSendResponse;
}

function makeEmail(ctx: ConnectorContext<Settings>): EmailCapability {
  const apiKey = requireApiKey(ctx);
  return {
    async send(msg) {
      const result = await postEmail(apiKey, ctx.settings, msg);
      ctx.logger.info(
        { messageId: result.id, to: Array.isArray(msg.to) ? msg.to.length : 1 },
        'resend.send',
      );
      return { messageId: result.id };
    },
  };
}

/**
 * Cheapest sane endpoint to confirm the key works: GET /domains. Returns
 * 200 with the verified domains list on a good key, 401 on a bad one.
 * Doesn't send any email and doesn't cost anything.
 */
async function verify(ctx: ConnectorContext<Settings>): Promise<void> {
  const apiKey = requireApiKey(ctx);
  const r = await fetch(`${ctx.settings.baseUrl}/domains`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (r.status === 401) {
    throw new Error('resend.verify: invalid API key (401)');
  }
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`resend.verify: ${r.status} ${text}`);
  }
}

export const manifest = {
  slug: 'resend',
  capability: 'email' as const,
  version: '0.0.1',
  displayName: 'Resend',
  authKind: 'api-key' as const,
  settingsSchema,
};

export default defineConnector({
  manifest,
  factory: (ctx) => makeEmail(ctx as ConnectorContext<Settings>),
  verify: (ctx) => verify(ctx as ConnectorContext<Settings>),
});
