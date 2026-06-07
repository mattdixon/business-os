import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Api, ApiError, type AgentRun, type AgentSummary } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { SchemaForm, type FieldSchema } from '../components/SchemaForm';

export function AgentDetail(): JSX.Element {
  const { slug } = useParams<{ slug: string }>();
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draftSettings, setDraftSettings] = useState<unknown>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runInput, setRunInput] = useState<unknown>({});
  const [runInputText, setRunInputText] = useState('{}');

  const reload = async (): Promise<void> => {
    if (!slug) return;
    try {
      const [a, r] = await Promise.all([Api.getAgent(slug), Api.listRuns(slug)]);
      setAgent(a);
      setRuns(r.runs);
      setDraftSettings(a.settings ?? {});
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'load failed');
    }
  };

  useEffect(() => {
    void reload();
  }, [slug]);

  const saveSettings = async (): Promise<void> => {
    if (!slug) return;
    setSaveState('saving');
    setSaveMsg(null);
    try {
      await Api.updateAgentSettings(slug, draftSettings);
      setSaveState('ok');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch (e: unknown) {
      setSaveState('error');
      setSaveMsg(e instanceof ApiError ? e.message : 'Save failed.');
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
      setTimeout(() => void reload(), 500);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'run failed');
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
          {saveMsg && (
            <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {saveMsg}
            </div>
          )}
          <div className="mt-4 flex items-center gap-3">
            <button className="btn-primary" onClick={saveSettings} disabled={saveState === 'saving'}>
              {saveState === 'saving' ? 'Saving…' : 'Save settings'}
            </button>
            {saveState === 'ok' && <span className="text-xs text-ok">Saved.</span>}
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
                  <tr key={r.id}>
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
        </section>
      </div>
    </div>
  );
}
