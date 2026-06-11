import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { Api, ApiError, type AgentRun, type AgentSummary, type ConnectorCapability } from '../lib/api';
import { apiErrorMessage } from '../lib/api-errors';
import { PageHeader } from '../components/PageHeader';
import { MissingCapabilityBanner } from '../components/MissingCapabilityBanner';
import { capabilityLabel } from '../lib/capability-labels';
import { SchemaForm, type FieldSchema } from '../components/SchemaForm';
import { ScheduleSection } from '../components/ScheduleSection';
import { useToast } from '../lib/toast';

export function AgentDetail(): JSX.Element {
  const { slug } = useParams<{ slug: string }>();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draftSettings, setDraftSettings] = useState<unknown>({});
  const [capabilities, setCapabilities] = useState<ConnectorCapability[] | null>(null);
  const [draftBindings, setDraftBindings] = useState<Record<string, string>>({});
  const [savingBindings, setSavingBindings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runInput, setRunInput] = useState<unknown>({});
  const [runInputText, setRunInputText] = useState('{}');
  const [runsNextBefore, setRunsNextBefore] = useState<string | null>(null);
  const [loadingMoreRuns, setLoadingMoreRuns] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [runInputOpen, setRunInputOpen] = useState(false);

  const reload = async (): Promise<void> => {
    if (!slug) return;
    try {
      const [a, r, c] = await Promise.all([
        Api.getAgent(slug),
        Api.listRuns(slug),
        Api.listConnectors(),
      ]);
      setAgent(a);
      setRuns(r.runs);
      setRunsNextBefore(r.nextBefore);
      setDraftSettings(a.settings ?? {});
      setCapabilities(c.capabilities);
      setDraftBindings(a.connectorBindings ?? {});
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'load failed');
    }
  };

  const saveBindings = async (): Promise<void> => {
    if (!slug) return;
    setSavingBindings(true);
    try {
      const clean = Object.fromEntries(
        Object.entries(draftBindings).filter(([, v]) => v && v.length > 0),
      );
      await Api.updateAgentBindings(slug, clean);
      toast.success('Connector bindings saved.');
      await reload();
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, 'Save failed.'));
    } finally {
      setSavingBindings(false);
    }
  };

  const loadMoreRuns = async (): Promise<void> => {
    if (!slug || !runsNextBefore) return;
    setLoadingMoreRuns(true);
    try {
      const r = await Api.listRuns(slug, { before: runsNextBefore });
      setRuns((prev) => [...prev, ...r.runs]);
      setRunsNextBefore(r.nextBefore);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'load more failed');
    } finally {
      setLoadingMoreRuns(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [slug]);

  const saveSettings = async (): Promise<void> => {
    if (!slug) return;
    setSaving(true);
    try {
      await Api.updateAgentSettings(slug, draftSettings);
      toast.success('Settings saved.');
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  const runNow = async (input?: unknown): Promise<void> => {
    if (!slug) return;
    setRunning(true);
    try {
      // When called from the hero button with no arg, fire with {} unless the
      // agent has a non-empty inputSchema (in which case the input modal supplies it).
      const effectiveInput =
        input !== undefined
          ? input
          : agent?.inputSchema
            ? runInput
            : runInputText.trim()
              ? JSON.parse(runInputText)
              : {};
      await Api.runAgent(slug, effectiveInput);
      toast.success('Run dispatched.');
      setRunInputOpen(false);
      setTimeout(() => void reload(), 500);
    } catch (e: unknown) {
      toast.error(apiErrorMessage(e, 'Run failed.'));
    } finally {
      setRunning(false);
    }
  };

  if (error) {
    return (
      <div className="p-6 sm:p-8">
        <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">{error}</div>
      </div>
    );
  }
  if (!agent) {
    return (
      <div className="p-6 sm:p-8 text-sm text-ink-500 dark:text-ink-400">Loading…</div>
    );
  }

  const schema = agent.settingsSchema as FieldSchema | undefined;
  const inputSchema = agent.inputSchema as FieldSchema | null | undefined;
  const hasInputFields =
    !!inputSchema &&
    inputSchema.type === 'object' &&
    Object.keys((inputSchema as { fields: object }).fields).length > 0;

  const lastRun = agent.lastRun;
  const lastRunStatus = (() => {
    if (!lastRun) return { label: 'Never run', tone: 'muted' as const };
    if (lastRun.ok === true) return { label: 'ok', tone: 'ok' as const };
    if (lastRun.ok === false) return { label: 'failed', tone: 'bad' as const };
    return { label: 'running', tone: 'warn' as const };
  })();
  const lastRunPill = {
    ok: 'pill-ok',
    bad: 'pill-bad',
    warn: 'pill-warn',
    muted: 'pill-muted',
  }[lastRunStatus.tone];

  return (
    <div>
      <PageHeader
        title={agent.displayName}
        description={agent.description}
        right={
          <button
            className="btn-ghost"
            onClick={() => setSettingsOpen(true)}
            aria-label="Agent settings"
            title="Settings"
          >
            {/* Inline SVG gear — avoids pulling in an icon library for one icon. */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span className="ml-2">Settings</span>
          </button>
        }
      />
      <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
        <MissingCapabilityBanner forCapabilities={agent.requiredConnectors} />

        {/* Hero: Run button + last-run summary. The single most important card
            on the page — anchors what the operator does here. */}
        <section className="card flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400">
              Last run
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className={lastRunPill}>{lastRunStatus.label}</span>
              {lastRun && (
                <Link
                  to={`/runs/${lastRun.id}`}
                  className="text-sm text-ink-700 hover:text-accent dark:text-ink-300"
                >
                  {lastRun.summary ?? '(no summary)'}
                </Link>
              )}
            </div>
            {lastRun && (
              <div className="mt-1 font-mono text-xs text-ink-500 dark:text-ink-400">
                {new Date(lastRun.startedAt).toLocaleString()}
              </div>
            )}
          </div>
          <button
            className="btn-primary btn-lg shrink-0"
            disabled={running}
            onClick={() => {
              if (hasInputFields) setRunInputOpen(true);
              else void runNow();
            }}
          >
            {running ? 'Running…' : 'Run now'}
          </button>
        </section>

        {/* Schedule — when this agent fires. */}
        <ScheduleSection slug={agent.slug} />

        {/* Recent runs — the second-most-important thing. */}
        <section className="card p-6">
          <h2 className="section-heading mb-4">Recent runs</h2>
          {runs.length === 0 ? (
            <div className="py-10 text-center text-sm text-ink-500 dark:text-ink-400">
              No runs yet. Hit Run now to fire the first one.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-ink-500 dark:text-ink-400">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Started</th>
                  <th className="px-4 py-2.5 text-left font-medium">Result</th>
                  <th className="px-4 py-2.5 text-left font-medium">Trigger</th>
                  <th className="px-4 py-2.5 text-left font-medium">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer transition-colors hover:bg-ink-50 dark:hover:bg-ink-800/50"
                    onClick={() => navigate(`/runs/${r.id}`)}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-500 dark:text-ink-400">
                      {new Date(r.startedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.ok === true ? (
                        <span className="pill-ok">ok</span>
                      ) : r.ok === false ? (
                        <span className="pill-bad">failed</span>
                      ) : (
                        <span className="pill-warn">running</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink-700 dark:text-ink-300">
                      {r.trigger}
                    </td>
                    <td className="px-4 py-2.5 text-ink-700 dark:text-ink-300">
                      {r.summary ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {runsNextBefore && (
            <div className="mt-4 text-center">
              <button
                className="btn-secondary"
                onClick={loadMoreRuns}
                disabled={loadingMoreRuns}
              >
                {loadingMoreRuns ? 'Loading…' : 'Load more runs'}
              </button>
            </div>
          )}
        </section>

        {/* Bindings — always visible because they're what makes Run work. */}
        {agent.requiredConnectors.length > 0 && (
          <section className="card p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-heading">Connectors</h2>
              <Link
                to="/connectors"
                className="text-xs font-medium text-accent transition-colors hover:text-accent-hover hover:underline"
              >
                Manage connector instances →
              </Link>
            </div>
            <p className="mb-4 text-sm text-ink-500 dark:text-ink-400">
              Pick which connector instance this agent uses for each capability it needs.
            </p>
            <div className="space-y-3">
              {agent.requiredConnectors.map((cap) => {
                const capDef = capabilities?.find((c) => c.capability === cap);
                const options = capDef?.instances.filter((i) => i.isActive) ?? [];
                const value = draftBindings[cap] ?? '';
                return (
                  <div key={cap} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[180px_1fr]">
                    <span className="text-sm text-ink-700 dark:text-ink-300">
                      {capabilityLabel(cap)}
                      <span className="ml-1.5 font-mono text-xs text-ink-500 dark:text-ink-400">{cap}</span>
                    </span>
                    {options.length === 0 ? (
                      <div className="text-xs text-ink-500 dark:text-ink-400">
                        No connected instances yet —{' '}
                        <Link to="/connectors" className="text-accent underline">
                          add one
                        </Link>
                        .
                      </div>
                    ) : (
                      <select
                        className="input"
                        value={value}
                        onChange={(e) =>
                          setDraftBindings((prev) => ({ ...prev, [cap]: e.target.value }))
                        }
                      >
                        <option value="">— pick one —</option>
                        {options.map((inst) => (
                          <option key={inst.id} value={inst.id}>
                            {inst.displayName}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-4">
              <button
                className="btn-primary"
                onClick={saveBindings}
                disabled={savingBindings}
              >
                {savingBindings ? 'Saving…' : 'Save bindings'}
              </button>
            </div>
          </section>
        )}
      </div>

      {/* Settings — slide-over drawer from the right. Set-once configuration
          doesn't compete with the operator's primary task (run + monitor). */}
      <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
          <Dialog.Content className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-xl flex-col bg-white shadow-xl dark:bg-ink-900">
            <div className="border-b border-ink-200 px-6 py-4 dark:border-ink-700">
              <Dialog.Title className="text-lg font-semibold tracking-tight">
                {agent.displayName} settings
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-ink-500 dark:text-ink-400">
                Set once; the agent uses these on every run until you change them.
              </Dialog.Description>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {schema ? (
                <SchemaForm schema={schema} value={draftSettings} onChange={setDraftSettings} />
              ) : (
                <textarea
                  className="input-mono h-72 resize-y"
                  value={JSON.stringify(draftSettings ?? {}, null, 2)}
                  onChange={(e) => {
                    try {
                      setDraftSettings(JSON.parse(e.target.value));
                    } catch {
                      // ignore until valid
                    }
                  }}
                  spellCheck={false}
                />
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-ink-200 px-6 py-4 dark:border-ink-700">
              <Dialog.Close asChild>
                <button className="btn-ghost">Cancel</button>
              </Dialog.Close>
              <button
                className="btn-primary"
                onClick={async () => {
                  await saveSettings();
                  setSettingsOpen(false);
                }}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save settings'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Run-with-input modal — only shown when the agent declares a non-empty
          inputSchema and the operator clicks Run from the hero. */}
      <Dialog.Root open={runInputOpen} onOpenChange={setRunInputOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl dark:bg-ink-900">
            <Dialog.Title className="text-lg font-semibold tracking-tight">
              Run {agent.displayName}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              Provide input for this run. It won't be saved as a default.
            </Dialog.Description>
            <div className="mt-5 max-h-[60vh] overflow-y-auto">
              {hasInputFields && inputSchema ? (
                <SchemaForm schema={inputSchema} value={runInput} onChange={setRunInput} />
              ) : (
                <textarea
                  className="input-mono h-32 resize-y"
                  value={runInputText}
                  onChange={(e) => setRunInputText(e.target.value)}
                  spellCheck={false}
                />
              )}
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <button className="btn-ghost" disabled={running}>
                  Cancel
                </button>
              </Dialog.Close>
              <button
                className="btn-primary"
                onClick={() => void runNow(runInput)}
                disabled={running}
              >
                {running ? 'Starting…' : 'Run'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
