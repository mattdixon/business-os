import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import { defineModule, type ModuleServerContext } from '@business-os/module-sdk';
import { exampleNotes } from './schema.js';

/**
 * @business-os/module-example
 *
 * The minimum shape of a real module. Demonstrates:
 *   - a settings schema (auto-rendered in the operator UI)
 *   - a migration directory the framework runs at boot
 *   - REST routes mounted under /api/modules/example/* by core
 *   - a UI page (defined in ../ui)
 *
 * Modules are standalone — they declare their own schema, own their tables,
 * and don't reach into other modules. Cross-module talk goes through REST.
 *
 * The actual DB client here is a per-module postgres-js connection. We don't
 * thread the core db through ctx because doing so would couple module-sdk to
 * Drizzle; modules pick their own access pattern.
 */

const here = dirname(fileURLToPath(import.meta.url));

const SettingsSchema = z.object({
  /** Max number of notes shown on the list page. Operator-editable. */
  pageSize: z.number().int().min(1).max(500).default(50),
});
type Settings = z.infer<typeof SettingsSchema>;

const CreateNoteRequest = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(10_000).default(''),
});

function buildDb(): ReturnType<typeof drizzle> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('module-example: DATABASE_URL not set');
  const sql = postgres(url, { max: 4 });
  return drizzle(sql);
}

export default defineModule({
  manifest: {
    slug: 'example',
    version: '0.0.1',
    displayName: 'Example',
    description: 'Notes — reference module proving the schema+routes+UI shape.',
    settingsSchema: SettingsSchema,
    // dist/server/index.js at runtime; ship the SQL directory next to it.
    // The migrations live at <pkg-root>/migrations regardless.
    migrationsDir: resolve(here, '..', '..', '..', 'migrations'),
  },
  registerRoutes: (rawApp, ctx: ModuleServerContext<Settings>) => {
    const app = rawApp as FastifyInstance;
    const db = buildDb();

    app.get('/notes', async () => {
      const rows = await db
        .select()
        .from(exampleNotes)
        .orderBy(desc(exampleNotes.createdAt))
        .limit(ctx.settings.pageSize);
      return { notes: rows };
    });

    app.post('/notes', async (req, reply) => {
      const parsed = CreateNoteRequest.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400).send({ error: 'invalid_input', issues: parsed.error.issues });
        return;
      }
      const rows = await db.insert(exampleNotes).values(parsed.data).returning();
      return { note: rows[0] };
    });

    app.delete('/notes/:id', async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const rows = await db
        .delete(exampleNotes)
        .where(eq(exampleNotes.id, id))
        .returning({ id: exampleNotes.id });
      if (rows.length === 0) {
        reply.code(404).send({ error: 'note_not_found' });
        return;
      }
      return { ok: true as const };
    });

    ctx.logger.info({ pageSize: ctx.settings.pageSize }, 'module-example routes ready');
  },
});

// Re-export the schema for tests + any sibling code that needs it.
export { exampleNotes } from './schema.js';
