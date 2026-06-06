import { Cron } from 'croner';
import type { Logger } from 'pino';
import type { Db } from '@business-os/db';
import type { Registry } from './registry.js';
import type { ConnectorResolver } from './active-connectors.js';
import { runAgent, type RunTrigger } from './run.js';

/**
 * In-process scheduler.
 *
 * Boots every cron-scheduled agent into a Cron job. Manual + event-triggered
 * agents stay idle until `triggerManual()` / `fireEvent()` is called.
 *
 * Distinguishing it from pg-boss:
 *  - This scheduler is *trigger* infrastructure: when should the runtime
 *    call runAgent?
 *  - pg-boss (TBD) is *queue* infrastructure: how do we persist + retry the
 *    work an agent enqueues via ctx.jobs.enqueue()?
 *
 * Multi-instance deploys must pick exactly one process to host the scheduler
 * — there's no leader election here yet. Single-process is fine for now since
 * each client install runs in one place.
 */

export interface SchedulerDeps {
  db: Db;
  registry: Registry;
  connectors: ConnectorResolver;
  logger: Logger;
}

export class Scheduler {
  private crons = new Map<string, Cron>();
  /** topic -> list of agent slugs subscribed via manifest.schedule.kind === 'event' */
  private eventSubs = new Map<string, string[]>();
  private started = false;

  constructor(private deps: SchedulerDeps) {}

  /**
   * Walk the registry, start cron jobs for cron-scheduled agents, build the
   * event subscription map for event-scheduled agents.
   * Manual agents do nothing on start.
   */
  start(): void {
    if (this.started) throw new Error('Scheduler already started');
    for (const agent of this.deps.registry.listAgents()) {
      const s = agent.manifest.schedule;
      const slug = agent.manifest.slug;
      if (s.kind === 'cron') {
        const cron = new Cron(s.expr, { timezone: 'UTC', protect: true }, async () => {
          await this.fireRun(slug, undefined, { kind: 'cron', detail: s.expr });
        });
        this.crons.set(slug, cron);
      } else if (s.kind === 'event') {
        const list = this.eventSubs.get(s.topic) ?? [];
        list.push(slug);
        this.eventSubs.set(s.topic, list);
      }
    }
    this.started = true;
    this.deps.logger.info(
      { cronCount: this.crons.size, eventTopics: this.eventSubs.size },
      'scheduler.started',
    );
  }

  async stop(): Promise<void> {
    for (const c of this.crons.values()) c.stop();
    this.crons.clear();
    this.eventSubs.clear();
    this.started = false;
  }

  /**
   * Trigger an agent manually. Works for any schedule kind — the operator can
   * always click "Run now" regardless of how the agent is normally fired.
   */
  async triggerManual(slug: string, input: unknown, triggeredBy: string): Promise<void> {
    await this.fireRun(slug, input, { kind: 'manual', detail: triggeredBy, triggeredBy });
  }

  /**
   * Fire an event topic; every agent subscribed to it runs (sequentially).
   */
  async fireEvent(topic: string, payload: unknown): Promise<void> {
    const subs = this.eventSubs.get(topic) ?? [];
    for (const slug of subs) {
      await this.fireRun(slug, payload, { kind: 'event', detail: topic });
    }
  }

  /** Visible only for tests. */
  _hasCron(slug: string): boolean {
    return this.crons.has(slug);
  }
  _subscribers(topic: string): string[] {
    return [...(this.eventSubs.get(topic) ?? [])];
  }

  private async fireRun(slug: string, input: unknown, trigger: RunTrigger): Promise<void> {
    try {
      await runAgent(
        {
          db: this.deps.db,
          registry: this.deps.registry,
          connectors: this.deps.connectors,
          logger: this.deps.logger,
        },
        slug,
        input,
        trigger,
      );
    } catch (err) {
      // Errors are already recorded in agent_runs by runAgent. Don't propagate
      // out of the cron callback — a thrown error would kill the cron timer.
      this.deps.logger.error({ err, slug }, 'scheduler.run_failed');
    }
  }
}
