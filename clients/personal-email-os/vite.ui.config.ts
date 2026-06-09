/**
 * Personal Email — operator UI Vite build.
 *
 * Builds src/ui/main.tsx into dist-ui/. Core serves that directory at /
 * when it exists, falling back to @business-os/ui's default bundle.
 *
 * `pnpm build:ui` → production bundle into dist-ui/
 * `pnpm dev:ui`   → Vite dev server on a fixed unique port (proxies /api,
 *                  /auth, /healthz, /readyz to API_PORT).
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_PORT = 4939;
const API_PROXY_TARGET = process.env.VITE_API_PROXY ?? 'http://localhost:4674';

export default defineConfig({
  plugins: [react()],
  root: 'src/ui',
  publicDir: false,
  server: {
    port: DEV_PORT,
    proxy: {
      '/api': { target: API_PROXY_TARGET, changeOrigin: true },
      '/auth': { target: API_PROXY_TARGET, changeOrigin: true },
      '/healthz': { target: API_PROXY_TARGET, changeOrigin: true },
      '/readyz': { target: API_PROXY_TARGET, changeOrigin: true },
      '/modules': { target: API_PROXY_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: '../../dist-ui',
    emptyOutDir: true,
    sourcemap: true,
  },
});
