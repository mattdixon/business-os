import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Api, ApiError, type AgentRun, type AgentSummary } from '../lib/api';
import { PageHeader } from '../components/PageHeader';

export function AgentDetail(): JSX.Element {
  const { slug } = useParams<{ slug: string }>();
  const [agent, setAgent] = useState<AgentSummary | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [settingsJson, setSettingsJson] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runInput, setRunInput] = useState('{}');

  const reload = async (): Promise<void> => {
    if (!slug) return;
    try {
      const [a, r] = await Promise.all([Api.getAgent(slug), Api.listRuns(slug)]);
      setAgent(a);
      setRuns(r.runs);
      setSettingsJson(JSON.stringify(a.settings ?? {}, null, 2));
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
      const value = JSON.parse(settingsJson);
      await Api.updateAgentSettings(slug, value);
      setSaveState('ok');
    } catch (e: unknown) {
      setSaveState('error');
      if (e instanceof SyntaxError) {
        setSaveMsg('Settings is not valid JSON.');
      } else if (e instanceof ApiError) {
        setSaveMsg(e.message);
      } else {
        setSaveMsg('Save failed.');
      }
    }
  };

  const runNow = async (): Promise<void> => {
    if (!slug) return;
    setRunning(true);
    try {
      const input = runInput.trim() ? JSON.parse(runInput) : {};
      await Api.runAgent(slug, input);
      // Give the worker a beat then refresh.
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
          <p className="mb-3 text-xs text-ink-500">
            Validated against the agent's manifest schema on save. JSON only for the MVP — a
            generated form lands next.
          </p>
          <textarea
            className="input-mono h-72 resize-y"
            value={settingsJson}
            onChange={(e) => setSettingsJson(e.target.value)}
            spellCheck={false}
          />
          {saveMsg && (
            <div className={`mt-2 text-xs ${saveState === 'ok' ? 'text-ok' : 'text-bad'}`}>
              {saveMsg}
            </div>
          )}
          <div className="mt-3 flex items-center gap-3">
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
          <p className="mb-3 text-xs text-ink-500">
            JSON passed to <code className="font-mono">run(ctx, input)</code>.
          </p>
          <textarea
            className="input-mono h-32 resize-y"
            value={runInput}
            onChange={(e) => setRunInput(e.target.value)}
            spellCheck={false}
          />
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
