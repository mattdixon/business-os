import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Login } from './pages/Login';
import { PasswordResetRequest, PasswordResetComplete } from './pages/PasswordReset';
import { Shell } from './components/Shell';
import { Dashboard } from './pages/Dashboard';
import { AgentsList } from './pages/AgentsList';
import { AgentDetail } from './pages/AgentDetail';
import { RunDetail } from './pages/RunDetail';
import { ConnectorsPage } from './pages/ConnectorsPage';
import { AuditPage } from './pages/AuditPage';
import { ModulePagePlaceholder } from './pages/ModulePagePlaceholder';
import { Settings } from './pages/Settings';
import { AuthProvider, RequireAuth } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toast';
import type { ModuleUiPage } from '@business-os/module-sdk';

/**
 * Per-module UI bundle. A client shell that wants module pages to render
 * passes one entry per registered module here.
 */
export interface ModuleUiBundle {
  /** Module slug — matches the one in business-os.config's registerModule call. */
  slug: string;
  /** UI pages exported by the module package's ./ui entry point. */
  pages: ModuleUiPage[];
}

export interface CreateOperatorAppOptions {
  /**
   * UI bundles for installed modules. Each bundle contributes routes under
   * /modules/<slug>/<page.path>. When omitted, /modules/:slug/* falls back
   * to a placeholder that explains how to wire it up.
   */
  modules?: ModuleUiBundle[];
}

/**
 * Build the operator app. Two consumers:
 *   1. @business-os/ui's own main.tsx (default no-module bundle served by core).
 *   2. A client shell's own UI entry that imports its modules and passes them
 *      in via `modules`.
 *
 * The shell-owned build replaces the default bundle when core's ui-serve finds
 * a `dist-ui/` directory in the shell's package root.
 */
export function createOperatorApp(options: CreateOperatorAppOptions = {}): {
  mount: (el: HTMLElement) => Root;
} {
  const modules = options.modules ?? [];

  return {
    mount(el): Root {
      const root = createRoot(el);
      root.render(
        <StrictMode>
          <BrowserRouter>
            <ToastProvider>
              <ThemeProvider>
              <AuthProvider>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route path="/reset/request" element={<PasswordResetRequest />} />
                  <Route path="/reset" element={<PasswordResetComplete />} />
                  <Route
                    path="/"
                    element={
                      <RequireAuth>
                        <Shell />
                      </RequireAuth>
                    }
                  >
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="dashboard" element={<Dashboard />} />
                    <Route path="agents" element={<AgentsList />} />
                    <Route path="agents/:slug" element={<AgentDetail />} />
                    <Route path="runs/:id" element={<RunDetail />} />
                    <Route path="connectors" element={<ConnectorsPage />} />
                    <Route path="audit" element={<AuditPage />} />
                    <Route path="settings" element={<Settings />} />

                    {/* Module routes — one Route per uiPage, plus a per-module
                        index fallback so /modules/<slug> with no pages still
                        works. */}
                    {modules.flatMap((m) =>
                      m.pages.map((p) => (
                        <Route
                          key={`${m.slug}/${p.path}`}
                          path={`modules/${m.slug}${p.path ? '/' + p.path : ''}`}
                          element={<p.Component />}
                        />
                      )),
                    )}

                    {/* Anything not matched by a module's own routes (e.g. the
                        module is registered server-side but didn't ship UI
                        pages in this build) renders the placeholder. */}
                    <Route path="modules/:slug/*" element={<ModulePagePlaceholder />} />
                  </Route>
                </Routes>
              </AuthProvider>
              </ThemeProvider>
            </ToastProvider>
          </BrowserRouter>
        </StrictMode>,
      );
      return root;
    },
  };
}
