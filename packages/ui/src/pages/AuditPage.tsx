import { useEffect, useState } from 'react';
import { Api, ApiError, type AuditEntry } from '../lib/api';
import { PageHeader } from '../components/PageHeader';

export function AuditPage(): JSX.Element {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [sinceHours, setSinceHours] = useState<string>('24');

  const load = async (): Promise<void> => {
    setError(null);
    try {
      const sinceIso =
        sinceHours === 'all'
          ? undefined
          : new Date(Date.now() - Number(sinceHours) * 3600_000).toISOString();
      const r = await Api.listAudit({
        action: actionFilter || undefined,
        agentSlug: agentFilter || undefined,
        since: sinceIso,
        limit: 200,
      });
      setEntries(r.entries);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'load failed');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter, agentFilter, sinceHours]);

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Every state-changing operation in this install. Filterable, exportable, immutable."
      />
      <div className="space-y-4 p-8">
        <div className="card flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="label">Action</label>
            <input
              className="input w-56"
              placeholder="e.g. admin.connector.update"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Agent slug</label>
            <input
              className="input w-40"
              placeholder="e.g. leadgen"
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Since</label>
            <select
              className="input"
              value={sinceHours}
              onChange={(e) => setSinceHours(e.target.value)}
            >
              <option value="1">Last hour</option>
              <option value="24">Last 24h</option>
              <option value="168">Last 7 days</option>
              <option value="720">Last 30 days</option>
              <option value="all">All time</option>
            </select>
          </div>
          <div className="grow" />
          <button className="btn-secondary" onClick={() => void load()}>
            Refresh
          </button>
        </div>

        {error && (
          <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
        )}
        {!entries ? (
          <div className="text-ink-500">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="card p-8 text-center text-sm text-ink-500">
            No audit entries match these filters.
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">When</th>
                  <th className="px-4 py-2 text-left font-medium">Action</th>
                  <th className="px-4 py-2 text-left font-medium">Actor</th>
                  <th className="px-4 py-2 text-left font-medium">Context</th>
                  <th className="px-4 py-2 text-left font-medium">Meta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2 align-top font-mono text-xs text-ink-500">
                      {new Date(e.at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 align-top">
                      <span className="font-mono text-xs">{e.action}</span>
                    </td>
                    <td className="px-4 py-2 align-top text-xs text-ink-700">
                      {e.userEmail ? (
                        <span className="font-mono">{e.userEmail}</span>
                      ) : (
                        <span className="text-ink-400">system</span>
                      )}
                    </td>
                    <td className="px-4 py-2 align-top text-xs text-ink-700">
                      {e.agentSlug && <span className="pill-muted">agent:{e.agentSlug}</span>}
                      {e.requestId && (
                        <span className="ml-1 font-mono text-ink-400">{e.requestId.slice(0, 8)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 align-top">
                      {e.meta ? (
                        <pre className="max-w-md overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-ink-700">
                          {JSON.stringify(e.meta, null, 0)}
                        </pre>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
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
