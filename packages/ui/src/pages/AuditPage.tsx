import { useEffect, useState } from 'react';
import { Api, ApiError, type AuditEntry } from '../lib/api';
import { PageHeader } from '../components/PageHeader';

export function AuditPage(): JSX.Element {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [sinceHours, setSinceHours] = useState<string>('24');
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const baseFilters = (): {
    action?: string;
    agentSlug?: string;
    since?: string;
  } => ({
    action: actionFilter || undefined,
    agentSlug: agentFilter || undefined,
    since:
      sinceHours === 'all'
        ? undefined
        : new Date(Date.now() - Number(sinceHours) * 3600_000).toISOString(),
  });

  const load = async (): Promise<void> => {
    setError(null);
    try {
      const r = await Api.listAudit({ ...baseFilters(), limit: 200 });
      setEntries(r.entries);
      setNextBefore(r.nextBefore);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'load failed');
    }
  };

  const loadMore = async (): Promise<void> => {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const r = await Api.listAudit({ ...baseFilters(), limit: 200, before: nextBefore });
      setEntries((prev) => [...(prev ?? []), ...r.entries]);
      setNextBefore(r.nextBefore);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'load more failed');
    } finally {
      setLoadingMore(false);
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
      <div className="space-y-4 p-6 sm:p-8">
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
          <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">{error}</div>
        )}
        {!entries ? (
          <div className="text-sm text-ink-500 dark:text-ink-400">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="card p-10 text-center text-sm text-ink-500 dark:text-ink-400">
            No audit entries match these filters.
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-[11px] uppercase tracking-wider text-ink-500 dark:bg-ink-800/60 dark:text-ink-400">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">When</th>
                  <th className="px-4 py-2.5 text-left font-medium">Action</th>
                  <th className="px-4 py-2.5 text-left font-medium">Actor</th>
                  <th className="px-4 py-2.5 text-left font-medium">Context</th>
                  <th className="px-4 py-2.5 text-left font-medium">Meta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                {entries.map((e) => (
                  <tr key={e.id} className="transition-colors hover:bg-ink-50 dark:hover:bg-ink-800/50">
                    <td className="px-4 py-2.5 align-top font-mono text-xs text-ink-500 dark:text-ink-400">
                      {new Date(e.at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <span className="font-mono text-xs">{e.action}</span>
                    </td>
                    <td className="px-4 py-2.5 align-top text-xs text-ink-700 dark:text-ink-300">
                      {e.userEmail ? (
                        <span className="font-mono">{e.userEmail}</span>
                      ) : (
                        <span className="text-ink-400 dark:text-ink-500">system</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 align-top text-xs text-ink-700 dark:text-ink-300">
                      {e.agentSlug && <span className="pill-muted">agent:{e.agentSlug}</span>}
                      {e.requestId && (
                        <span className="ml-1 font-mono text-ink-400 dark:text-ink-500">{e.requestId.slice(0, 8)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      {e.meta ? (
                        <pre className="max-w-md overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-ink-700 dark:text-ink-300">
                          {JSON.stringify(e.meta, null, 0)}
                        </pre>
                      ) : (
                        <span className="text-ink-400 dark:text-ink-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {nextBefore && (
          <div className="text-center">
            <button className="btn-secondary" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
