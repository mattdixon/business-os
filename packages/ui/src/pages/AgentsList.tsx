import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Api, ApiError, type AgentSummary } from '../lib/api';
import { PageHeader } from '../components/PageHeader';

function ScheduleLabel({ s }: { s: AgentSummary['schedule'] }): JSX.Element {
  if (s.kind === 'cron') return <span className="font-mono text-xs">{s.expr}</span>;
  if (s.kind === 'event') return <span>event: {s.topic}</span>;
  return <span className="text-ink-500 dark:text-ink-400">manual</span>;
}

function LastRunCell({ run }: { run: AgentSummary['lastRun'] }): JSX.Element {
  if (!run) return <span className="text-ink-400 dark:text-ink-500">—</span>;
  const className = run.ok === true ? 'pill-ok' : run.ok === false ? 'pill-bad' : 'pill-warn';
  const label = run.ok === true ? 'ok' : run.ok === false ? 'failed' : 'running';
  return (
    <div className="flex items-center gap-2">
      <span className={className}>{label}</span>
      <span className="truncate text-xs text-ink-500 dark:text-ink-400">{run.summary ?? ''}</span>
    </div>
  );
}

export function AgentsList(): JSX.Element {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Api.listAgents()
      .then((r) => setAgents(r.agents))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'load failed'));
  }, []);

  return (
    <div>
      <PageHeader
        title="Agents"
        description="Everything running on this install. Click an agent to configure or run it."
      />
      <div className="px-8 py-6">
        {error && (
          <div className="card mb-4 border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">
            {error}
          </div>
        )}
        {!agents ? (
          <div className="text-ink-500 dark:text-ink-400">Loading…</div>
        ) : agents.length === 0 ? (
          <div className="card p-8 text-center text-sm text-ink-500 dark:text-ink-400">
            No agents registered. Add one in <code className="font-mono">business-os.config.ts</code>.
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500 dark:bg-ink-800 dark:text-ink-400">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Agent</th>
                  <th className="px-4 py-2 text-left font-medium">Schedule</th>
                  <th className="px-4 py-2 text-left font-medium">Last run</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {agents.map((a) => (
                  <tr key={a.slug} className="hover:bg-ink-50 dark:hover:bg-ink-800">
                    <td className="px-4 py-3">
                      <Link
                        to={`/agents/${a.slug}`}
                        className="font-medium text-ink-900 hover:text-accent dark:text-ink-100"
                      >
                        {a.displayName}
                      </Link>
                      <div className="font-mono text-xs text-ink-500 dark:text-ink-400">
                        {a.slug} · v{a.version}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-700 dark:text-ink-300">
                      <ScheduleLabel s={a.schedule} />
                    </td>
                    <td className="px-4 py-3">
                      <LastRunCell run={a.lastRun} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
