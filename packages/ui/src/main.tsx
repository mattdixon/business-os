import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';
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
import { ToastProvider } from './lib/toast';

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
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
              <Route path="modules/:slug/*" element={<ModulePagePlaceholder />} />
              <Route path="audit" element={<AuditPage />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
