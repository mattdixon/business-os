import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import {
  defineConnector,
  type ConnectorContext,
  type CrmCapability,
  type CrmContact,
  type CrmTask,
} from '@frontrangesystems/business-os-connector-sdk';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { crmStubContacts, crmStubNotes, crmStubTags, crmStubTasks } from './schema.js';

/**
 * Dev/demo CRM provider.
 *
 * Stores contacts + tags + notes + tasks in this install's own DB, in the
 * `crm_stub_*` tables shipped by this package's migrations. Useful for:
 *   - Local development without a real CRM hooked up.
 *   - Demos where you want everything visible in a single DB.
 *   - Smoke tests of agents that need a working CrmCapability.
 *
 * NOT for production: real installs swap in @frontrangesystems/business-os-connector-ghl,
 * @frontrangesystems/business-os-connector-hubspot, etc.
 *
 * Operator note: the CRM table lives in the same Postgres as the framework
 * itself. The settings.databaseUrl override lets a client point this
 * provider at a separate DB if they want CRM data isolated.
 */

const settingsSchema = z.object({
  /** Optional override; defaults to DATABASE_URL via the connector context. */
  databaseUrl: z.string().optional(),
});

type Settings = z.infer<typeof settingsSchema>;

function makeCrm(ctx: ConnectorContext<Settings>): CrmCapability {
  // The CrmCapability needs its own DB handle. The connector-sdk doesn't pass
  // one through ctx (capabilities are runtime-neutral), so we build a small
  // postgres-js client. Reuses the framework env's DATABASE_URL by default.
  const url = ctx.settings.databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('connector-crm-stub: DATABASE_URL not set and no settings.databaseUrl override');
  }
  const sql = postgres(url, { max: 4 });
  const db = drizzle(sql);

  return {
    async upsertContact(c: CrmContact): Promise<{ id: string }> {
      const email = c.email?.toLowerCase().trim();
      if (email) {
        const existing = await db
          .select({ id: crmStubContacts.id })
          .from(crmStubContacts)
          .where(eq(crmStubContacts.email, email))
          .limit(1);
        if (existing[0]) {
          await db
            .update(crmStubContacts)
            .set({
              firstName: c.firstName ?? null,
              lastName: c.lastName ?? null,
              phone: c.phone ?? null,
              company: c.company ?? null,
              custom: c.customFields ?? {},
              updatedAt: new Date(),
            })
            .where(eq(crmStubContacts.id, existing[0].id));
          ctx.logger.info({ id: existing[0].id, email }, 'crm-stub.upsert.update');
          return { id: existing[0].id };
        }
      }
      const rows = await db
        .insert(crmStubContacts)
        .values({
          email,
          firstName: c.firstName,
          lastName: c.lastName,
          phone: c.phone,
          company: c.company,
          custom: c.customFields ?? {},
        })
        .returning({ id: crmStubContacts.id });
      ctx.logger.info({ id: rows[0]!.id, email }, 'crm-stub.upsert.insert');
      return { id: rows[0]!.id };
    },

    async findContactByEmail(email: string): Promise<CrmContact | null> {
      const rows = await db
        .select()
        .from(crmStubContacts)
        .where(eq(crmStubContacts.email, email.toLowerCase().trim()))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        email: row.email ?? undefined,
        firstName: row.firstName ?? undefined,
        lastName: row.lastName ?? undefined,
        phone: row.phone ?? undefined,
        company: row.company ?? undefined,
        customFields: (row.custom as Record<string, string | number | boolean>) ?? undefined,
      };
    },

    async addTag(contactId: string, tag: string): Promise<void> {
      await db
        .insert(crmStubTags)
        .values({ contactId, tag })
        .onConflictDoNothing({ target: [crmStubTags.contactId, crmStubTags.tag] });
    },

    async addNote(contactId: string, note: string): Promise<void> {
      await db.insert(crmStubNotes).values({ contactId, body: note });
    },

    async createTask(contactId: string, task: CrmTask): Promise<{ id: string }> {
      const rows = await db
        .insert(crmStubTasks)
        .values({
          contactId,
          title: task.title,
          body: task.body,
          dueAt: task.dueAt,
        })
        .returning({ id: crmStubTasks.id });
      return { id: rows[0]!.id };
    },
  };
}

export const manifest = {
  slug: 'crm-stub',
  capability: 'crm' as const,
  version: '0.0.1',
  displayName: 'CRM (stub)',
  authKind: 'none' as const,
  settingsSchema,
};

export default defineConnector({
  manifest,
  factory: (ctx) => makeCrm(ctx as ConnectorContext<Settings>),
});

// Re-export so client shells can wire migrations into extraMigrations.
export { crmStubMigrations } from './migrations.js';
export { and };
