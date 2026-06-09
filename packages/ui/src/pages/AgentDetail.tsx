import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Api, ApiError, type AgentRun, type AgentSummary, type ConnectorCapability } from '../lib/api';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { SchemaForm, type FieldSchema } from '../components/SchemaForm';
import { useToast } from '../lib/toast';

/** Pull a friendly message out of an ApiError that may carry Zod issues. */
function apiErrorMessage(e: unknown, fallback: string): string {
  if (!(e instanceof ApiError)) return fallback;
  const body = e.body as { error?: string; issues?: Array<{ path?: string[]; message?: string }> } | null;
  if (body?.issues && body.issues.length > 0) {
    return body.issues
      .map((i) => `${i.path?.join('.') ?? 'value'}: ${i.message ?? 'invalid'}`)
      .join('; ');
  }
  return e.message || fallback;
}

export function AgentDetail(): JSX.Element {
  const { slug } = useParams<{ slug: string }>();
  const { toast } = useToast();
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
      // Strip empty values — operator left a capability unset; we don't want
      // to send "" through and trip the uuid validator.
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

  const runNow = async (): Promise<void> => {
    if (!slug) return;
    setRunning(true);
    try {
      // When the agent has an inputSchema, runInput holds the typed value
      // managed by SchemaForm. When it doesn't, we fall back to JSON-textarea
      // text and parse it here.
      const input = agent?.inputSchema
        ? runInput
        : runInputText.trim()
          ? JSON.parse(runInputText)
          : {};
      await Api.runAgent(slug, input);
      toast.success('Run dispatched.');
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

  return (
    <div>
      <PageHeader
        title={agent.displayName}
        description={agent.description}
        right={
          <button className="btn-primary" disabled={running} onClick={runNow}>
            {running ? 'Running…' : 'Run now'}
          </button>
        }
      />
      <div className="mx-auto grid max-w-6xl gap-6 p-6 sm:p-8 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="section-heading mb-4">Settings</h2>
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
          <div className="mt-4 flex items-center gap-3">
            <button className="btn-primary" onClick={saveSettings} disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </section>

        <section className="card p-6">
          <h2 className="section-heading mb-4">Manual run input</h2>
          {agent.inputSchema ? (
            <SchemaForm
              schema={agent.inputSchema as FieldSchema}
              value={runInput}
              onChange={setRunInput}
            />
          ) : (
            <>
              <p className="mb-3 text-xs text-ink-500 dark:text-ink-400">
                JSON passed to <code className="font-mono">run(ctx, input)</code>.
              </p>
              <textarea
                className="input-mono h-32 resize-y"
                value={runInputText}
                onChange={(e) => setRunInputText(e.target.value)}
                spellCheck={false}
              />
            </>
          )}
        </section>

        {agent.requiredConnectors.length > 0 && (
          <section className="card p-6 lg:col-span-2">
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
              Add new instances on the{' '}
              <Link to="/connectors" className="text-accent underline">Connectors page</Link>;
              they'll show up here once connected.
            </p>
            <div className="space-y-3">
              {agent.requiredConnectors.map((cap) => {
                const capDef = capabilities?.find((c) => c.capability === cap);
                const options = capDef?.instances.filter((i) => i.isActive) ?? [];
                const value = draftBindings[cap] ?? '';
                return (
                  <div key={cap} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[120px_1fr]">
                    <span className="font-mono text-xs text-ink-700 dark:text-ink-300">{cap}</span>
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
                            {inst.displayName} ({inst.providerSlug})
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

        <section className="card p-6 lg:col-span-2">
          <h2 className="section-heading mb-4">Recent runs</h2>
          {runs.length === 0 ? (
            <div className="py-10 text-center text-sm text-ink-500 dark:text-ink-400">
              No runs yet.
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
                    onClick={() => {
                      window.location.href = `/runs/${r.id}`;
                    }}
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
      </div>
    </div>
  );
}
