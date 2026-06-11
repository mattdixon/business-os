import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { defineModule, type ModuleServerContext } from '@business-os/module-sdk';
import { requireUser } from '@business-os/core';
import { prospectorBidFeedback, bidWatcherSeen } from './schema.js';

/**
 * @business-os/module-prospector
 *
 * Surfaces scored bid opportunities + collects per-user thumbs feedback.
 * Reads bids from `bid_watcher_seen` (owned by the bid-watcher agent).
 * Owns its own feedback table `prospector_bid_feedback`.
 */

const here = dirname(fileURLToPath(import.meta.url));

const SettingsSchema = z.object({
  /** Cap on how many bids the dashboard "new bids" section pulls per render. */
  newSectionSize: z.number().int().min(1).max(100).default(20),
  /** Minimum score to consider showing in the dashboard's main section. */
  minDashboardScore: z.number().int().min(0).max(100).default(60),
});
type Settings = z.infer<typeof SettingsSchema>;

const FeedbackRequest = z.object({
  rating: z.union([z.literal(1), z.literal(-1)]),
  reason: z.string().max(500).optional(),
});

function buildDb(): ReturnType<typeof drizzle> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('module-prospector: DATABASE_URL not set');
  const client = postgres(url, { max: 4 });
  return drizzle(client);
}

export default defineModule({
  manifest: {
    slug: 'prospector',
    version: '0.0.1',
    displayName: 'Prospector',
    description: 'Surfaces scored bid opportunities. Tracks thumbs feedback for future relevance tuning.',
    settingsSchema: SettingsSchema,
    migrationsDir: resolve(here, '..', '..', 'migrations'),
  },
  registerRoutes: (rawApp, ctx: ModuleServerContext<Settings>) => {
    const app = rawApp as FastifyInstance;
    const db = buildDb();

    /**
     * GET /modules/prospector/bids
     * Returns scored bids sorted high → low. Joins each row with the
     * caller's own thumbs rating if any.
     */
    app.get(
      '/bids',
      { preHandler: requireUser },
      async (req: FastifyRequest, reply: FastifyReply) => {
        const userId = req.user!.id;
        const limit = Number((req.query as { limit?: string }).limit ?? ctx.settings.newSectionSize);
        const status = (req.query as { status?: string }).status ?? null;

        // Read bids + left-join the caller's feedback in one query.
        const rows = await db
          .select({
            source: bidWatcherSeen.source,
            externalId: bidWatcherSeen.externalId,
            title: bidWatcherSeen.title,
            url: bidWatcherSeen.url,
            location: bidWatcherSeen.location,
            estimatedValue: bidWatcherSeen.estimatedValue,
            bidsDueAt: bidWatcherSeen.bidsDueAt,
            score: bidWatcherSeen.score,
            scoreReason: bidWatcherSeen.scoreReason,
            gaps: bidWatcherSeen.gaps,
            status: bidWatcherSeen.status,
            firstSeenAt: bidWatcherSeen.firstSeenAt,
            lastSeenAt: bidWatcherSeen.lastSeenAt,
            myRating: prospectorBidFeedback.rating,
          })
          .from(bidWatcherSeen)
          .leftJoin(
            prospectorBidFeedback,
            and(
              eq(prospectorBidFeedback.source, bidWatcherSeen.source),
              eq(prospectorBidFeedback.externalId, bidWatcherSeen.externalId),
              eq(prospectorBidFeedback.userId, userId),
            ),
          )
          .where(status ? eq(bidWatcherSeen.status, status) : sql`TRUE`)
          .orderBy(desc(bidWatcherSeen.score), desc(bidWatcherSeen.firstSeenAt))
          .limit(Math.min(limit, 100));

        return {
          bids: rows.map((r) => ({
            ...r,
            estimatedValue: r.estimatedValue !== null ? Number(r.estimatedValue) : null,
          })),
        };
      },
    );

    /**
     * GET /modules/prospector/home
     * Dashboard payload — sectioned for direct rendering by /home.
     * v1: one section "New bids" filtered by minDashboardScore.
     */
    app.get(
      '/home',
      { preHandler: requireUser },
      async (req: FastifyRequest) => {
        const userId = req.user!.id;
        const min = ctx.settings.minDashboardScore;
        const size = ctx.settings.newSectionSize;

        const rows = await db
          .select({
            source: bidWatcherSeen.source,
            externalId: bidWatcherSeen.externalId,
            title: bidWatcherSeen.title,
            url: bidWatcherSeen.url,
            location: bidWatcherSeen.location,
            estimatedValue: bidWatcherSeen.estimatedValue,
            bidsDueAt: bidWatcherSeen.bidsDueAt,
            score: bidWatcherSeen.score,
            scoreReason: bidWatcherSeen.scoreReason,
            status: bidWatcherSeen.status,
            firstSeenAt: bidWatcherSeen.firstSeenAt,
            myRating: prospectorBidFeedback.rating,
          })
          .from(bidWatcherSeen)
          .leftJoin(
            prospectorBidFeedback,
            and(
              eq(prospectorBidFeedback.source, bidWatcherSeen.source),
              eq(prospectorBidFeedback.externalId, bidWatcherSeen.externalId),
              eq(prospectorBidFeedback.userId, userId),
            ),
          )
          .where(and(
            eq(bidWatcherSeen.status, 'new'),
            sql`${bidWatcherSeen.score} >= ${min}`,
          ))
          .orderBy(desc(bidWatcherSeen.score), desc(bidWatcherSeen.firstSeenAt))
          .limit(size);

        return {
          sections: [
            {
              id: 'new-bids',
              title: 'New bids worth a look',
              subtitle: `Score ≥ ${min}, not yet triaged`,
              cards: rows.map((r) => ({
                id: `${r.source}::${r.externalId}`,
                source: r.source,
                externalId: r.externalId,
                title: r.title ?? 'Untitled',
                subtitle: [
                  r.location,
                  r.estimatedValue !== null ? `$${Number(r.estimatedValue).toLocaleString()}` : null,
                  r.bidsDueAt ? `Due ${new Date(r.bidsDueAt as unknown as string).toLocaleDateString()}` : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
                score: r.score,
                scoreReason: r.scoreReason,
                href: r.url ?? null,
                myRating: r.myRating ?? null,
              })),
            },
          ],
        };
      },
    );

    /**
     * POST /modules/prospector/bids/:source/:externalId/feedback
     * Upsert a thumbs rating for the current user.
     */
    app.post(
      '/bids/:source/:externalId/feedback',
      { preHandler: requireUser },
      async (req: FastifyRequest, reply: FastifyReply) => {
        const userId = req.user!.id;
        const { source, externalId } = req.params as { source: string; externalId: string };
        const parsed = FeedbackRequest.safeParse(req.body);
        if (!parsed.success) {
          reply.code(400).send({ error: 'invalid_input', issues: parsed.error.issues });
          return;
        }

        await db
          .insert(prospectorBidFeedback)
          .values({
            userId,
            source,
            externalId,
            rating: parsed.data.rating,
            reason: parsed.data.reason ?? null,
          })
          .onConflictDoUpdate({
            target: [
              prospectorBidFeedback.userId,
              prospectorBidFeedback.source,
              prospectorBidFeedback.externalId,
            ],
            set: {
              rating: parsed.data.rating,
              reason: parsed.data.reason ?? null,
              updatedAt: new Date(),
            },
          });

        await req.audit('prospector.feedback.set', {
          source,
          externalId,
          rating: parsed.data.rating,
        });
        return { ok: true as const };
      },
    );

    ctx.logger.info(
      { minDashboardScore: ctx.settings.minDashboardScore, newSectionSize: ctx.settings.newSectionSize },
      'module-prospector routes ready',
    );
  },
});

export { prospectorBidFeedback, bidWatcherSeen } from './schema.js';
