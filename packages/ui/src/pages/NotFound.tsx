import { Link } from 'react-router-dom';

/**
 * Catch-all 404 page. Renders inside the authenticated Shell so the sidebar
 * stays visible — the operator who typoed a URL doesn't lose their
 * navigation context, they just see "this isn't a thing, here are some
 * things that are."
 */
export function NotFound(): JSX.Element {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6 sm:p-8">
      <div className="card max-w-md p-10 text-center">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400">
          404
        </div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
          That URL isn't a thing in this install. Try one of these:
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm">
          <Link to="/agents" className="btn-secondary">
            Agents
          </Link>
          <Link to="/connectors" className="btn-secondary">
            Connectors
          </Link>
          <Link to="/dashboard" className="btn-secondary">
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
