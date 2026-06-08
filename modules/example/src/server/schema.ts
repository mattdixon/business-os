import { pgTable, text, timestamp, uuid, index } from 'drizzle-orm/pg-core';

export const exampleNotes = pgTable(
  'example_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ createdIdx: index('example_notes_created_idx').on(t.createdAt) }),
);
