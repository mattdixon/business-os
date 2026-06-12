/**
 * Personal Email — dev seed.
 *
 * Bootstraps a freshly-migrated install to a state where Matt can sign in
 * and start configuring inbox connectors. Specifically:
 *   1. Creates an operator user (default: admin@localhost / change-me-now).
 *   2. Seeds sample agent settings for the three inbox triage agents so
 *      the forms are pre-filled with reasonable defaults.
 *
 * Does NOT create connector instances — those are user-driven via the
 * "Connect Outlook" / "Connect Gmail" / "Set up IMAP" UI flows. Real
 * credentials must come from the operator (no stub providers for the
 * email-inbox capability — there's nothing useful to stub).
 *
 * Safe to re-run: every step is upsert-or-skip.
 *
 * NEVER run in production — the seeded user has a known password.
 * Aborts if NODE_ENV=production.
 */

import 'dotenv/config';
import { createDb, settings as settingsTable, users } from '@frontrangesystems/business-os-db';
import { hashPassword } from '@frontrangesystems/business-os-core/auth';
import { eq } from 'drizzle-orm';

const DEFAULT_EMAIL = process.env.SEED_DEV_EMAIL ?? 'admin@localhost';
const DEFAULT_PASSWORD = process.env.SEED_DEV_PASSWORD ?? 'change-me-now-please';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-dev.ts must NOT be run in production (NODE_ENV=production)');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const { db, sql } = createDb({ url });
  try {
    // 1. Operator user.
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, DEFAULT_EMAIL.toLowerCase()))
      .limit(1);
    if (existing[0]) {
      // eslint-disable-next-line no-console
      console.log(`[seed] user already exists: ${DEFAULT_EMAIL}`);
    } else {
      const passwordHash = await hashPassword(DEFAULT_PASSWORD);
      await db.insert(users).values({
        email: DEFAULT_EMAIL.toLowerCase(),
        passwordHash,
        displayName: 'Operator',
      });
      // eslint-disable-next-line no-console
      console.log(`[seed] created user ${DEFAULT_EMAIL} (password: ${DEFAULT_PASSWORD})`);
    }

    // 2. Sample agent settings — pre-populate sensible defaults so the
    // operator forms render meaningful values on first visit.
    const upsertSettings = async (scope: string, value: unknown): Promise<void> => {
      await db
        .insert(settingsTable)
        .values({ scope, value })
        .onConflictDoUpdate({
          target: settingsTable.scope,
          set: { value, updatedAt: new Date() },
        });
      // eslint-disable-next-line no-console
      console.log(`[seed] settings: ${scope}`);
    };

    await upsertSettings('agent:inbox-cleanup', {
      llm: {},
      maxMessages: 500,
      cleanupAction: 'dry-run', // start safe — operator flips to archive/trash once happy
      neverTouchSenders: [],
      unreadOnly: true,
    });

    await upsertSettings('agent:inbox-categorize', {
      llm: {},
      maxMessages: 200,
      categories: ['Newsletter', 'Receipt', 'Notification', 'Personal', 'Work', 'Action-Needed'],
      confidenceThreshold: 0.6,
      unreadOnly: true,
    });

    await upsertSettings('agent:inbox-surface', {
      llm: {},
      maxMessages: 200,
      windowDays: 3,
      vipSenders: [],
      digestSize: 15,
    });

    // eslint-disable-next-line no-console
    console.log(`\n[seed] Done. Sign in at the operator UI with:`);
    // eslint-disable-next-line no-console
    console.log(`         email:    ${DEFAULT_EMAIL}`);
    // eslint-disable-next-line no-console
    console.log(`         password: ${DEFAULT_PASSWORD}\n`);
    // eslint-disable-next-line no-console
    console.log(`       Next: under Connectors, add an Anthropic or OpenAI key,`);
    // eslint-disable-next-line no-console
    console.log(`       then connect Outlook / Gmail / IMAP from the same page.`);
    // eslint-disable-next-line no-console
    console.log(`       Inbox-cleanup defaults to dry-run mode — flip to archive`);
    // eslint-disable-next-line no-console
    console.log(`       or trash in Settings once you've reviewed a few runs.\n`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed] failed:', err);
  process.exit(1);
});
