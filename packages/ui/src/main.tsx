import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';
import { Login } from './pages/Login';
import { Shell } from './components/Shell';
import { AgentsList } from './pages/AgentsList';
import { AgentDetail } from './pages/AgentDetail';
import { ConnectorsPage } from './pages/ConnectorsPage';
import { Settings } from './pages/Settings';
import { AuthProvider, RequireAuth } from './lib/auth';

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Shell />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/agents" replace />} />
            <Route path="agents" element={<AgentsList />} />
            <Route path="agents/:slug" element={<AgentDetail />} />
            <Route path="connectors" element={<ConnectorsPage />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
