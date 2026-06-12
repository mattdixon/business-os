import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { defineAgent, type AgentResult } from '@frontrangesystems/business-os-agent-sdk';

/**
 * Daily digest.
 *
 * Once a day:
 *   1. Walk every active user.
 *   2. For each, call every registered module's `digestContribution(ctx)`.
 *   3. Drop empty contributions.
 *   4. Compose one email per user (sections per module + a link to /home).
 *   5. Send via the `email` capability — operator picks the provider
 *      (Resend is the framework default; Gmail/Outlook also valid).
 *   6. Record `user_digest_state.last_sent_at` so the next run uses it
 *      as the `since` cursor for each module.
 *
 * Urgency: out of scope for v1. The contract supports `isUrgent` items
 * but the agent currently just flags them inside the digest body. A
 * dedicated immediate-email path lands when we wire `urgent_notifications_sent`.
 *
 * To enable: the operator opens "Add Agent" in the operator UI and
 * picks "Daily digest" — same flow as any framework agent. Schedule
 * default is 0 7 * * * (7am in the install's tz). Override via the
 * per-agent Schedule section.
 */

const SettingsSchema = z.object({
  /**
   * "From" name shown on the email envelope. Combined with the email
   * connector's defaultFrom address.
   */
  fromName: z.string().default('Business OS'),
  /**
   * The first-time `since` window when a user has no last_sent_at row.
   * Days. Default 7 — enough that the first morning shows real content.
   */
  firstTimeWindowDays: z.number().int().min(1).max(60).default(7),
  /**
   * Operator-facing URL where users land when they click the "open"
   * link inside the digest. Should be the install's public URL.
   * Defaults to env PUBLIC_URL; can be overridden per-agent.
   */
  baseUrl: z.string().url().optional(),
});

type Settings = z.infer<typeof SettingsSchema>;

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  last_sent_at: Date | null;
}

interface ModuleSettingsRow {
  value: unknown;
}

interface ContributionResult {
  moduleSlug: string;
  moduleDisplayName: string;
  contribution: {
    sectionTitle: string;
    summary?: string;
    items: Array<{ title: string; subtitle?: string; href: string; isUrgent?: boolean }>;
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function joinUrl(base: string | undefined, path: string): string {
  if (!base) return path;
  const trimmed = base.replace(/\/$/, '');
  return path.startsWith('/') ? `${trimmed}${path}` : `${trimmed}/${path}`;
}

function renderEmail(
  recipient: { email: string; displayName: string | null },
  results: ContributionResult[],
  baseUrl: string | undefined,
): { subject: string; html: string; text: string } {
  const greeting = recipient.displayName?.split(/\s+/)[0] ?? 'there';
  const urgentCount = results.reduce(
    (acc, r) => acc + r.contribution.items.filter((i) => i.isUrgent).length,
    0,
  );
  const totalItems = results.reduce((acc, r) => acc + r.contribution.items.length, 0);

  const subject =
    urgentCount > 0
      ? `[URGENT × ${urgentCount}] Your daily digest — ${totalItems} items`
      : `Your daily digest — ${totalItems} ${totalItems === 1 ? 'item' : 'items'}`;

  const homeUrl = joinUrl(baseUrl, '/home');

  const htmlParts: string[] = [];
  htmlParts.push(`<p>Morning, ${escapeHtml(greeting)}.</p>`);
  htmlParts.push(`<p>Here's what's new since your last digest.</p>`);
  for (const r of results) {
    htmlParts.push(`<h2 style="margin-top:24px;font-size:16px;">${escapeHtml(r.contribution.sectionTitle)} — ${escapeHtml(r.moduleDisplayName)}</h2>`);
    if (r.contribution.summary) {
      htmlParts.push(`<p style="color:#555;margin:4px 0 12px;">${escapeHtml(r.contribution.summary)}</p>`);
    }
    htmlParts.push('<ul style="padding-left:18px;">');
    for (const item of r.contribution.items) {
      const href = joinUrl(baseUrl, item.href);
      const urgent = item.isUrgent ? ' <strong style="color:#b91c1c;">[URGENT]</strong>' : '';
      htmlParts.push(
        `<li style="margin-bottom:6px;"><a href="${escapeHtml(href)}">${escapeHtml(item.title)}</a>${urgent}${
          item.subtitle ? `<br><span style="color:#666;font-size:13px;">${escapeHtml(item.subtitle)}</span>` : ''
        }</li>`,
      );
    }
    htmlParts.push('</ul>');
  }
  htmlParts.push(`<p style="margin-top:24px;"><a href="${escapeHtml(homeUrl)}" style="background:#111;color:#fff;padding:8px 16px;text-decoration:none;border-radius:4px;">Open dashboard</a></p>`);

  const textParts: string[] = [`Morning, ${greeting}.`, "Here's what's new since your last digest.", ''];
  for (const r of results) {
    textParts.push(`${r.contribution.sectionTitle} — ${r.moduleDisplayName}`);
    if (r.contribution.summary) textParts.push(r.contribution.summary);
    for (const item of r.contribution.items) {
      const href = joinUrl(baseUrl, item.href);
      const urgent = item.isUrgent ? ' [URGENT]' : '';
      textParts.push(`  • ${item.title}${urgent}`);
      if (item.subtitle) textParts.push(`      ${item.subtitle}`);
      textParts.push(`      ${href}`);
    }
    textParts.push('');
  }
  textParts.push(`Open dashboard: ${homeUrl}`);

  return { subject, html: htmlParts.join('\n'), text: textParts.join('\n') };
}

export default defineAgent({
  manifest: {
    slug: 'digest',
    version: '0.0.1',
    displayName: 'Daily digest',
    description:
      "One morning email per user summarizing what each installed module has new. Pulls from each module's digestContribution.",
    requiredConnectors: ['email'],
    settingsSchema: SettingsSchema,
    schedule: { kind: 'cron', expr: '0 7 * * *' },
    supportedTriggers: ['manual', 'cron'] as const,
  },
  run: async (ctx): Promise<AgentResult> => {
    const settings: Settings = ctx.settings;
    const email = await ctx.connector('email');
    const db = ctx.db as {
      execute: <T>(q: ReturnType<typeof sql>) => Promise<T[]>;
    };

    const userRows = await db.execute<UserRow>(sql`
      SELECT u.id, u.email, u.display_name, s.last_sent_at
        FROM users u
        LEFT JOIN user_digest_state s ON s.user_id = u.id
       WHERE u.is_active = TRUE
    `);

    // Pre-load every module's persisted settings ({} when no row). The
    // contribution functions read settings, so passing `undefined` would
    // crash them; we walk the settings table once and reuse for every
    // user we iterate.
    const moduleSettings = new Map<string, unknown>();
    for (const mod of ctx.modules) {
      if (!mod.digestContribution) continue;
      const rows = await db.execute<ModuleSettingsRow>(sql`
        SELECT value FROM settings WHERE scope = ${`module:${mod.slug}`} LIMIT 1
      `);
      moduleSettings.set(mod.slug, rows[0]?.value ?? {});
    }

    const firstTimeWindowMs = settings.firstTimeWindowDays * 24 * 60 * 60 * 1000;

    let sent = 0;
    let skipped = 0;
    const errors: Array<{ userId: string; reason: string }> = [];

    for (const user of userRows) {
      const sinceMs = user.last_sent_at
        ? new Date(user.last_sent_at).getTime()
        : Date.now() - firstTimeWindowMs;
      const since = new Date(sinceMs);

      const contributions: ContributionResult[] = [];
      for (const mod of ctx.modules) {
        if (!mod.digestContribution) continue;
        try {
          const c = await mod.digestContribution({
            user: { id: user.id, email: user.email },
            since,
            logger: ctx.logger,
            settings: moduleSettings.get(mod.slug) ?? {},
          });
          if (c && c.items.length > 0) {
            contributions.push({
              moduleSlug: mod.slug,
              moduleDisplayName: mod.displayName,
              contribution: c,
            });
          }
        } catch (err) {
          ctx.logger.warn(
            { err, moduleSlug: mod.slug, userId: user.id },
            'digest.contribution_failed',
          );
        }
      }

      if (contributions.length === 0) {
        skipped += 1;
        continue;
      }

      const { subject, html, text } = renderEmail(
        { email: user.email, displayName: user.display_name },
        contributions,
        settings.baseUrl ?? process.env.PUBLIC_URL,
      );

      try {
        await email.send({
          to: user.email,
          subject,
          html,
          text,
        });
        await db.execute(sql`
          INSERT INTO user_digest_state (user_id, last_sent_at)
          VALUES (${user.id}, now())
          ON CONFLICT (user_id) DO UPDATE
            SET last_sent_at = EXCLUDED.last_sent_at,
                updated_at = now()
        `);
        sent += 1;
      } catch (err) {
        errors.push({
          userId: user.id,
          reason: err instanceof Error ? err.message : String(err),
        });
        ctx.logger.error({ err, userId: user.id }, 'digest.send_failed');
      }
    }

    await ctx.audit('digest.run', {
      totalUsers: userRows.length,
      sent,
      skipped,
      errorCount: errors.length,
    });

    return {
      ok: errors.length === 0,
      summary:
        errors.length === 0
          ? `sent ${sent} digest${sent === 1 ? '' : 's'} (${skipped} skipped — no new items)`
          : `sent ${sent}, ${errors.length} failed, ${skipped} skipped`,
      details: { totalUsers: userRows.length, sent, skipped, errors },
    };
  },
});
