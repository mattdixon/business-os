import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Api } from '../lib/api';

interface ModuleNav {
  slug: string;
  displayName: string;
  pages: Array<{ path: string; navLabel?: string }>;
}

export function Shell(): JSX.Element {
  const { state, logout } = useAuth();
  const navigate = useNavigate();
  const user = state.kind === 'authenticated' ? state.user : null;
  const [modules, setModules] = useState<ModuleNav[]>([]);

  useEffect(() => {
    if (state.kind !== 'authenticated') return;
    Api.listModules()
      .then((r) =>
        setModules(
          r.modules.map((m) => ({
            slug: m.slug,
            displayName: m.displayName,
            pages: m.uiPages,
          })),
        ),
      )
      .catch(() => {
        // /api/modules may not exist on older cores or when no modules are wired.
        setModules([]);
      });
  }, [state.kind]);

  return (
    <div className="flex h-full min-h-screen bg-ink-50 text-ink-900 dark:bg-ink-950 dark:text-ink-100">
      <aside className="flex w-56 shrink-0 flex-col border-r border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
        <div className="border-b border-ink-200 px-4 py-4 dark:border-ink-800">
          <div className="text-sm font-semibold tracking-tight">Business OS</div>
          <div className="text-xs text-ink-400 dark:text-ink-500">Operator</div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2 text-sm">
          <NavItem to="/dashboard">Dashboard</NavItem>
          <NavItem to="/agents">Agents</NavItem>
          <NavItem to="/connectors">Connectors</NavItem>
          {modules.length > 0 && (
            <div className="mt-3 px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">
              Modules
            </div>
          )}
          {modules.map((m) =>
            m.pages.length === 0 ? (
              <NavItem key={m.slug} to={`/modules/${m.slug}`}>
                {m.displayName}
              </NavItem>
            ) : (
              m.pages
                .filter((p) => p.navLabel)
                .map((p) => (
                  <NavItem
                    key={`${m.slug}-${p.path}`}
                    to={`/modules/${m.slug}${p.path ? '/' + p.path : ''}`}
                  >
                    {p.navLabel}
                  </NavItem>
                ))
            ),
          )}
          <div className="mt-3 px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-400 dark:text-ink-500">
            Operator
          </div>
          <NavItem to="/audit">Audit log</NavItem>
          <NavItem to="/settings">Settings</NavItem>
        </nav>
        <div className="border-t border-ink-200 px-4 py-3 text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
          <div className="truncate">{user?.email ?? '—'}</div>
          <button
            className="mt-2 text-accent hover:underline"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }): JSX.Element {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded px-3 py-1.5 ${
          isActive
            ? 'bg-ink-100 font-medium text-ink-900 dark:bg-ink-800 dark:text-ink-100'
            : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:text-ink-400 dark:hover:bg-ink-800 dark:hover:text-ink-100'
        }`
      }
    >
      {children}
    </NavLink>
  );
}
