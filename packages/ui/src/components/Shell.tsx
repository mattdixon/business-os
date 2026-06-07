import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function Shell(): JSX.Element {
  const { state, logout } = useAuth();
  const navigate = useNavigate();
  const user = state.kind === 'authenticated' ? state.user : null;

  return (
    <div className="flex h-full min-h-screen bg-ink-50 text-ink-900">
      <aside className="flex w-56 shrink-0 flex-col border-r border-ink-200 bg-white">
        <div className="border-b border-ink-200 px-4 py-4">
          <div className="text-sm font-semibold tracking-tight">Business OS</div>
          <div className="text-xs text-ink-400">Operator</div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2 text-sm">
          <NavItem to="/agents">Agents</NavItem>
          <NavItem to="/connectors">Connectors</NavItem>
          <NavItem to="/audit">Audit log</NavItem>
          <NavItem to="/settings">Settings</NavItem>
        </nav>
        <div className="border-t border-ink-200 px-4 py-3 text-xs text-ink-500">
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
            ? 'bg-ink-100 font-medium text-ink-900'
            : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900'
        }`
      }
    >
      {children}
    </NavLink>
  );
}
