import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  defineConnector,
  type ConnectorContext,
  type EmailCapability,
  type InboundEmail,
  type OutboundEmail,
} from '@business-os/connector-sdk';

/**
 * Dev/demo email provider.
 *
 * Doesn't actually send anything. Every send() returns a fake messageId and
 * emits a logger.info line. Use this in development, demo environments, and
 * smoke tests; swap in @business-os/connector-gmail (or similar) for prod.
 *
 * listInbox() returns an empty array by default. Operators can paste sample
 * inbound messages via the `seedInbox` setting for testing email-triage agents
 * without hitting a real IMAP/Gmail account.
 */

const settingsSchema = z.object({
  /** Free-form label that appears in logs / audit metadata. */
  label: z.string().default('email-stub'),
  /** Optional seed inbox — array of fake inbound emails returned by listInbox(). */
  seedInbox: z
    .array(
      z.object({
        from: z.string().email(),
        to: z.array(z.string().email()).default([]),
        subject: z.string(),
        text: z.string(),
        receivedAt: z.string().datetime().optional(),
      }),
    )
    .default([]),
});

type Settings = z.infer<typeof settingsSchema>;

function makeEmail(ctx: ConnectorContext<Settings>): EmailCapability {
  return {
    async send(msg: OutboundEmail): Promise<{ messageId: string }> {
      const messageId = `stub-${randomUUID()}`;
      ctx.logger.info(
        {
          label: ctx.settings.label,
          to: Array.isArray(msg.to) ? msg.to : [msg.to],
          subject: msg.subject,
          length: (msg.text ?? msg.html ?? '').length,
          messageId,
        },
        'email-stub.send',
      );
      return { messageId };
    },

    async listInbox(): Promise<InboundEmail[]> {
      return ctx.settings.seedInbox.map((m, i) => ({
        id: `stub-${i}`,
        threadId: `stub-thread-${i}`,
        from: m.from,
        to: m.to,
        subject: m.subject,
        text: m.text,
        receivedAt: m.receivedAt ? new Date(m.receivedAt) : new Date(),
      }));
    },
  };
}

export const manifest = {
  slug: 'email-stub',
  capability: 'email' as const,
  version: '0.0.1',
  displayName: 'Email (stub)',
  authKind: 'none' as const,
  settingsSchema,
};

export default defineConnector({
  manifest,
  factory: (ctx) => makeEmail(ctx as ConnectorContext<Settings>),
});
