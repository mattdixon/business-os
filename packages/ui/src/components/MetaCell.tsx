/**
 * Renders an audit `meta` blob as readable key:value lines for flat objects,
 * falling back to a JSON dump for anything nested. Audit meta is typically
 * `{ to: 'foo', subject: 'bar' }` — a one-line JSON.stringify hides that.
 */
export function MetaCell({ meta }: { meta: unknown }): JSX.Element {
  if (meta === null || meta === undefined) {
    return <span className="text-ink-400 dark:text-ink-500">—</span>;
  }
  if (typeof meta !== 'object' || Array.isArray(meta)) {
    return (
      <code className="block whitespace-pre-wrap break-all font-mono text-[11px] text-ink-700 dark:text-ink-300">
        {JSON.stringify(meta)}
      </code>
    );
  }
  const entries = Object.entries(meta as Record<string, unknown>);
  if (entries.length === 0) {
    return <span className="text-ink-400 dark:text-ink-500">{'{ }'}</span>;
  }
  const allFlat = entries.every(
    ([, v]) => v === null || typeof v !== 'object',
  );
  if (!allFlat) {
    return (
      <code className="block max-w-md whitespace-pre-wrap break-words font-mono text-[11px] text-ink-700 dark:text-ink-300">
        {JSON.stringify(meta, null, 2)}
      </code>
    );
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-mono text-ink-500 dark:text-ink-400">{k}:</dt>
          <dd className="break-words font-mono text-ink-700 dark:text-ink-300">
            {v === null
              ? 'null'
              : typeof v === 'string'
                ? v
                : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
