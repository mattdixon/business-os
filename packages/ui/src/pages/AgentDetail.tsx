import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Api, ApiError, type AgentRun, type AgentSummary } from '../lib/api';
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
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runInput, setRunInput] = useState<unknown>({});
  const [runInputText, setRunInputText] = useState('{}');
  const [runsNextBefore, setRunsNextBefore] = useState<string | null>(null);
  const [loadingMoreRuns, setLoadingMoreRuns] = useState(false);

  const reload = async (): Promise<void> => {
    if (!slug) return;
    try {
      const [a, r] = await Promise.all([Api.getAgent(slug), Api.listRuns(slug)]);
      setAgent(a);
      setRuns(r.runs);
      setRunsNextBefore(r.nextBefore);
      setDraftSettings(a.settings ?? {});
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'load failed');
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
      <div className="p-8">
        <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      </div>
    );
  }
  if (!agent) {
    return <div className="p-8 text-ink-500">Loading…</div>;
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
      <div className="grid gap-6 p-8 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
            Settings
          </h2>
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

        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
            Manual run input
          </h2>
          {agent.inputSchema ? (
            <SchemaForm
              schema={agent.inputSchema as FieldSchema}
              value={runInput}
              onChange={setRunInput}
            />
          ) : (
            <>
              <p className="mb-3 text-xs text-ink-500">
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
          <div className="mt-3 text-xs text-ink-500">
            Required connectors:{' '}
            {agent.requiredConnectors.length === 0
              ? '—'
              : agent.requiredConnectors.map((c) => (
                  <span key={c} className="pill-muted mr-1">
                    {c}
                  </span>
                ))}
          </div>
        </section>

        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
            Recent runs
          </h2>
          {runs.length === 0 ? (
            <div className="py-6 text-center text-sm text-ink-400">No runs yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Started</th>
                  <th className="px-3 py-2 text-left font-medium">Result</th>
                  <th className="px-3 py-2 text-left font-medium">Trigger</th>
                  <th className="px-3 py-2 text-left font-medium">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer hover:bg-ink-50"
                    onClick={() => {
                      window.location.href = `/runs/${r.id}`;
                    }}
                  >
                    <td className="px-3 py-2 font-mono text-xs text-ink-500">
                      {new Date(r.startedAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {r.ok === true ? (
                        <span className="pill-ok">ok</span>
                      ) : r.ok === false ? (
                        <span className="pill-bad">failed</span>
                      ) : (
                        <span className="pill-warn">running</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-700">{r.trigger}</td>
                    <td className="px-3 py-2 text-ink-700">{r.summary ?? '—'}</td>
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
