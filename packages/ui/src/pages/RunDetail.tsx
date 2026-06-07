import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Api, ApiError, type AgentRun, type AuditEntry } from '../lib/api';
import { PageHeader } from '../components/PageHeader';

interface RunWithDetails extends AgentRun {
  agentSlug: string;
  details: unknown;
}

export function RunDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunWithDetails | null>(null);
  const [audits, setAudits] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Api.getRun(id)
      .then(({ run, audits }) => {
        setRun(run);
        setAudits(audits);
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'load failed'));
  }, [id]);

  if (error) {
    return (
      <div className="p-8">
        <div className="card border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      </div>
    );
  }
  if (!run) {
    return <div className="p-8 text-ink-500">Loading…</div>;
  }

  const durationMs = run.endedAt
    ? new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()
    : null;

  return (
    <div>
      <PageHeader
        title={`Run · ${run.agentSlug}`}
        description={
          <span className="font-mono text-xs">
            {run.id}
          </span> as unknown as string
        }
        right={
          <Link to={`/agents/${run.agentSlug}`} className="btn-secondary">
            ← Agent
          </Link>
        }
      />
      <div className="grid gap-6 p-8 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
            Outcome
          </h2>
          <div className="space-y-2 text-sm">
            <Row label="Started">{new Date(run.startedAt).toLocaleString()}</Row>
            <Row label="Ended">
              {run.endedAt ? new Date(run.endedAt).toLocaleString() : '—'}
            </Row>
            <Row label="Duration">
              {durationMs == null ? '—' : `${(durationMs / 1000).toFixed(2)}s`}
            </Row>
            <Row label="Trigger">
              <span className="font-mono text-xs">{run.trigger ?? '—'}</span>
            </Row>
            <Row label="Triggered by">
              <span className="font-mono text-xs">{run.triggeredBy ?? 'system'}</span>
            </Row>
            <Row label="Status">
              {run.ok === true ? (
                <span className="pill-ok">ok</span>
              ) : run.ok === false ? (
                <span className="pill-bad">failed</span>
              ) : (
                <span className="pill-warn">running</span>
              )}
            </Row>
            <Row label="Summary">{run.summary ?? '—'}</Row>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
            Details
          </h2>
          {run.details ? (
            <pre className="max-h-96 overflow-auto rounded bg-ink-50 p-3 font-mono text-xs text-ink-800">
              {JSON.stringify(run.details, null, 2)}
            </pre>
          ) : (
            <div className="text-sm text-ink-400">No details emitted.</div>
          )}
        </section>

        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
            Audit trail for this run
          </h2>
          {audits.length === 0 ? (
            <div className="py-6 text-center text-sm text-ink-400">
              No audit entries — this run didn't call ctx.audit().
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">When</th>
                  <th className="px-3 py-2 text-left font-medium">Action</th>
                  <th className="px-3 py-2 text-left font-medium">Meta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {audits.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2 align-top font-mono text-xs text-ink-500">
                      {new Date(a.at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="font-mono text-xs">{a.action}</span>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {a.meta ? (
                        <pre className="max-w-xl overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-ink-700">
                          {JSON.stringify(a.meta)}
                        </pre>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
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

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex gap-3 border-b border-ink-100 py-1 last:border-b-0">
      <div className="w-32 shrink-0 text-xs uppercase tracking-wide text-ink-500">{label}</div>
      <div className="text-ink-800">{children}</div>
    </div>
  );
}
