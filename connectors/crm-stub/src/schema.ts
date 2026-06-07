import { pgTable, text, timestamp, uuid, jsonb, primaryKey, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const crmStubContacts = pgTable(
  'crm_stub_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    phone: text('phone'),
    company: text('company'),
    custom: jsonb('custom').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ emailUniq: uniqueIndex('crm_stub_contacts_email_uniq').on(t.email) }),
);

export const crmStubTags = pgTable(
  'crm_stub_tags',
  {
    contactId: uuid('contact_id').notNull().references(() => crmStubContacts.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.contactId, t.tag] }) }),
);

export const crmStubNotes = pgTable(
  'crm_stub_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id').notNull().references(() => crmStubContacts.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ contactIdx: index('crm_stub_notes_contact_idx').on(t.contactId) }),
);

export const crmStubTasks = pgTable(
  'crm_stub_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contactId: uuid('contact_id').notNull().references(() => crmStubContacts.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ contactIdx: index('crm_stub_tasks_contact_idx').on(t.contactId) }),
);
