import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Api, ApiError } from '../lib/api';
import { apiErrorMessage } from '../lib/api-errors';
import { useToast } from '../lib/toast';

/**
 * Renders an agent's effective trigger as a pill plus an Edit pencil that
 * opens a small dialog. The operator picks among the agent's
 * `supportedTriggers` (manual / cron / event). The override is persisted to
 * the DB; the scheduler honors it on next refresh.
 *
 * Event mode is shown only if the agent supports it AND at least one
 * connector instance with a known event topic is available — gated in a
 * follow-up PR. For now event-capable agents see "Event triggers are not
 * yet wired up" as a placeholder.
 *
 * Cron mode offers a small dropdown of common presets plus a "Custom" option
 * that reveals a free-text cron-expression field.
 */

type Schedule =
  | { kind: 'manual' }
  | { kind: 'cron'; expr: string }
  | { kind: 'event'; topic: string };

interface ScheduleData {
  manifest: Schedule;
  override: Schedule | null;
  effective: Schedule;
  supportedTriggers: Array<'cron' | 'manual' | 'event'>;
}

const CRON_PRESETS: Array<{ label: string; expr: string }> = [
  { label: 'Every 15 minutes', expr: '*/15 * * * *' },
  { label: 'Every 30 minutes', expr: '*/30 * * * *' },
  { label: 'Every hour', expr: '0 * * * *' },
  { label: 'Every 6 hours', expr: '0 */6 * * *' },
  { label: 'Daily at 9 AM UTC', expr: '0 9 * * *' },
  { label: 'Weekly (Mon 9 AM UTC)', expr: '0 9 * * 1' },
];

export function ScheduleSection({ slug }: { slug: string }): JSX.Element {
  const { toast } = useToast();
  const [data, setData] = useState<ScheduleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const reload = (): void => {
    Api.getAgentSchedule(slug)
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message : 'load failed'),
      );
  };

  useEffect(() => {
    reload();
  }, [slug]);

  if (error) {
    return (
      <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">
        Schedule: {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="card p-4 text-sm text-ink-500 dark:text-ink-400">Loading schedule…</div>
    );
  }

  const eff = data.effective;
  const effLabel = describeSchedule(eff);
  const overrideActive = !!data.override;

  return (
    <section className="card flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400">
          Schedule
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="pill-muted">{effLabel}</span>
          {overrideActive ? (
            <span className="text-xs text-ink-500 dark:text-ink-400">
              operator override · manifest says {describeSchedule(data.manifest)}
            </span>
          ) : (
            <span className="text-xs text-ink-500 dark:text-ink-400">manifest default</span>
          )}
        </div>
      </div>
      <button className="btn-secondary shrink-0" onClick={() => setEditing(true)}>
        Edit
      </button>
      <EditDialog
        open={editing}
        onOpenChange={setEditing}
        data={data}
        slug={slug}
        onSaved={(next) => {
          setData((prev) => (prev ? { ...prev, override: next, effective: next ?? prev.manifest } : prev));
          toast.success('Schedule saved.');
          setEditing(false);
        }}
      />
    </section>
  );
}

function describeSchedule(s: Schedule): string {
  if (s.kind === 'manual') return 'Manual only';
  if (s.kind === 'cron') {
    const preset = CRON_PRESETS.find((p) => p.expr === s.expr);
    return preset ? preset.label : `Cron · ${s.expr}`;
  }
  return `Event · ${s.topic}`;
}

function EditDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ScheduleData;
  slug: string;
  onSaved: (next: Schedule | null) => void;
}): JSX.Element {
  const { toast } = useToast();
  const initialKind = (props.data.override ?? props.data.manifest).kind;
  const [kind, setKind] = useState<'cron' | 'manual' | 'event'>(initialKind);
  const [cronExpr, setCronExpr] = useState<string>(
    props.data.override?.kind === 'cron'
      ? props.data.override.expr
      : props.data.manifest.kind === 'cron'
        ? props.data.manifest.expr
        : CRON_PRESETS[0]!.expr,
  );
  const [eventTopic, setEventTopic] = useState<string>(
    props.data.override?.kind === 'event'
      ? props.data.override.topic
      : props.data.manifest.kind === 'event'
        ? props.data.manifest.topic
        : '',
  );
  const [busy, setBusy] = useState(false);

  // Reset state when dialog reopens.
  useEffect(() => {
    if (!props.open) return;
    const k = (props.data.override ?? props.data.manifest).kind;
    setKind(k);
    setBusy(false);
  }, [props.open, props.data]);

  const supported = new Set(props.data.supportedTriggers);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      let next: Schedule;
      if (kind === 'manual') next = { kind: 'manual' };
      else if (kind === 'cron') next = { kind: 'cron', expr: cronExpr };
      else next = { kind: 'event', topic: eventTopic };
      await Api.setAgentSchedule(props.slug, next);
      props.onSaved(next);
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, 'Save failed.'));
    } finally {
      setBusy(false);
    }
  };

  const revert = async (): Promise<void> => {
    setBusy(true);
    try {
      await Api.setAgentSchedule(props.slug, null);
      props.onSaved(null);
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, 'Revert failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl dark:bg-ink-900">
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            Edit schedule
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-ink-500 dark:text-ink-400">
            Pick when this agent fires. Override the manifest default, or revert to it.
          </Dialog.Description>
          <div className="mt-5 space-y-5">
            <fieldset>
              <legend className="label">Trigger</legend>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(['manual', 'cron', 'event'] as const).map((k) => {
                  const allowed = supported.has(k);
                  const selected = k === kind;
                  return (
                    <label
                      key={k}
                      className={
                        'rounded-md border px-3 py-1.5 text-sm transition-colors ' +
                        (allowed ? 'cursor-pointer ' : 'opacity-40 cursor-not-allowed ') +
                        (selected
                          ? 'border-accent bg-accent/10 text-accent dark:border-accent dark:bg-accent/20'
                          : 'border-ink-200 hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800')
                      }
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name="trigger-kind"
                        value={k}
                        checked={selected}
                        disabled={!allowed}
                        onChange={() => setKind(k)}
                      />
                      {k === 'manual' ? 'Manual' : k === 'cron' ? 'Cron' : 'Event'}
                    </label>
                  );
                })}
              </div>
              {kind === 'event' && (
                <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
                  Event triggers aren't wired up yet — the override saves, but the
                  scheduler won't fire on events until the connector implements{' '}
                  <code className="font-mono text-[10px]">subscribeToEvents</code>.
                </p>
              )}
            </fieldset>
            {kind === 'cron' && (
              <div>
                <label className="label">Cron preset</label>
                <select
                  className="input"
                  value={CRON_PRESETS.some((p) => p.expr === cronExpr) ? cronExpr : 'custom'}
                  onChange={(e) => {
                    if (e.target.value !== 'custom') setCronExpr(e.target.value);
                  }}
                >
                  {CRON_PRESETS.map((p) => (
                    <option key={p.expr} value={p.expr}>
                      {p.label} ({p.expr})
                    </option>
                  ))}
                  <option value="custom">Custom…</option>
                </select>
                <input
                  className="input mt-2 font-mono"
                  value={cronExpr}
                  onChange={(e) => setCronExpr(e.target.value)}
                  placeholder="* * * * *"
                />
                <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                  5-field UTC cron. Use crontab.guru if you need to dial it in.
                </p>
              </div>
            )}
            {kind === 'event' && (
              <div>
                <label className="label">Event topic</label>
                <input
                  className="input font-mono"
                  value={eventTopic}
                  onChange={(e) => setEventTopic(e.target.value)}
                  placeholder="email-inbox.message.received"
                />
              </div>
            )}
          </div>
          <div className="mt-6 flex items-center justify-end gap-2">
            {props.data.override && (
              <button
                className="btn-ghost"
                onClick={revert}
                disabled={busy}
                title="Revert to the manifest's default schedule"
              >
                Revert to manifest
              </button>
            )}
            <div className="flex-1" />
            <Dialog.Close asChild>
              <button className="btn-ghost" disabled={busy}>
                Cancel
              </button>
            </Dialog.Close>
            <button
              className="btn-primary"
              onClick={save}
              disabled={busy || (kind === 'event' && !eventTopic) || (kind === 'cron' && !cronExpr)}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
