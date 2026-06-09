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
      <aside className="flex w-60 shrink-0 flex-col border-r border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
        <div className="border-b border-ink-200 px-5 py-4 dark:border-ink-800">
          <div className="text-sm font-semibold tracking-tight">Business OS</div>
          <div className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">Operator console</div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-3 text-sm">
          <NavItem to="/dashboard">Dashboard</NavItem>
          <NavItem to="/agents">Agents</NavItem>
          <NavItem to="/connectors">Connectors</NavItem>
          <NavItem to="/providers">Providers</NavItem>
          {modules.length > 0 && <SidebarLabel>Modules</SidebarLabel>}
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
          <SidebarLabel>Operator</SidebarLabel>
          <NavItem to="/audit">Audit log</NavItem>
          <NavItem to="/settings">Settings</NavItem>
        </nav>
        <div className="border-t border-ink-200 px-5 py-4 text-xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
          <div className="truncate font-mono">{user?.email ?? '—'}</div>
          <button
            className="mt-2 text-accent transition-colors hover:text-accent-hover hover:underline"
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
        `rounded-md px-3 py-2 transition-colors ${
          isActive
            ? 'bg-accent/10 font-medium text-accent dark:bg-accent/20'
            : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-100'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

function SidebarLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="mt-4 px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400 dark:text-ink-500">
      {children}
    </div>
  );
}
