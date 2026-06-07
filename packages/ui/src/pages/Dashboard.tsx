import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Api, ApiError, type AgentRun } from '../lib/api';
import { PageHeader } from '../components/PageHeader';

interface DashboardData {
  agentCount: number;
  recentRuns: Array<AgentRun & { agentSlug: string }>;
  capabilities: Array<{
    capability: string;
    registered: number;
    configured: number;
    activeProvider: string | null;
  }>;
}

export function Dashboard(): JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Api.getDashboard()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'load failed'));
  }, []);

  if (error) {
    return (
      <div className="p-8">
        <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      </div>
    );
  }
  if (!data) {
    return <div className="p-8 text-ink-500">Loading…</div>;
  }

  const ok = data.recentRuns.filter((r) => r.ok === true).length;
  const failed = data.recentRuns.filter((r) => r.ok === false).length;

  return (
    <div>
      <PageHeader title="Dashboard" description="Quick status across this install." />
      <div className="grid gap-6 p-8 lg:grid-cols-3">
        <Tile label="Agents" value={data.agentCount.toString()} href="/agents" />
        <Tile
          label="Recent runs"
          value={`${data.recentRuns.length}`}
          sub={`${ok} ok · ${failed} failed`}
        />
        <Tile
          label="Capabilities covered"
          value={`${data.capabilities.filter((c) => c.activeProvider).length} / ${data.capabilities.length}`}
          sub="active providers"
          href="/connectors"
        />

        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
            Recent runs
          </h2>
          {data.recentRuns.length === 0 ? (
            <div className="py-6 text-center text-sm text-ink-400">
              No runs yet. Open an agent and click "Run now".
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Started</th>
                  <th className="px-3 py-2 text-left font-medium">Agent</th>
                  <th className="px-3 py-2 text-left font-medium">Result</th>
                  <th className="px-3 py-2 text-left font-medium">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {data.recentRuns.map((r) => (
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
                      <Link
                        to={`/agents/${r.agentSlug}`}
                        className="font-mono text-xs text-ink-700 hover:text-accent"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.agentSlug}
                      </Link>
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
                    <td className="px-3 py-2 text-ink-700">{r.summary ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
            Capability coverage
          </h2>
          <div className="space-y-2 text-sm">
            {data.capabilities.map((c) => (
              <div
                key={c.capability}
                className="flex items-center justify-between border-b border-ink-100 py-2 last:border-b-0"
              >
                <div>
                  <div className="font-mono">{c.capability}</div>
                  <div className="text-xs text-ink-500">
                    {c.registered} provider{c.registered === 1 ? '' : 's'} · {c.configured} instance
                    {c.configured === 1 ? '' : 's'}
                  </div>
                </div>
                {c.activeProvider ? (
                  <span className="pill-ok">{c.activeProvider}</span>
                ) : c.configured > 0 ? (
                  <span className="pill-warn">none active</span>
                ) : (
                  <span className="pill-muted">not configured</span>
                )}
              </div>
            ))}
          </div>
          <Link
            to="/connectors"
            className="mt-4 inline-block text-xs text-accent hover:underline"
          >
            Manage connectors →
          </Link>
        </section>
      </div>
    </div>
  );
}

function Tile(props: { label: string; value: string; sub?: string; href?: string }): JSX.Element {
  const inner = (
    <div className="card flex h-full flex-col p-5">
      <div className="text-xs uppercase tracking-wide text-ink-500">{props.label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-ink-900">{props.value}</div>
      {props.sub && <div className="mt-1 text-xs text-ink-500">{props.sub}</div>}
    </div>
  );
  return props.href ? (
    <Link to={props.href} className="block transition hover:translate-y-[-1px]">
      {inner}
    </Link>
  ) : (
    inner
  );
}
