import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Per Matt's global preference: never use 3000 / 5000 / 5173 / 8080 etc.
// Picked a fixed unique port in 4000-9999 for this project.
const DEV_PORT = 4937;
// In dev, proxy API calls to the running Fastify on API_PORT (default 4673).
const API_PROXY_TARGET = process.env.VITE_API_PROXY ?? 'http://localhost:4673';

export default defineConfig({
  plugins: [react()],
  server: {
    port: DEV_PORT,
    proxy: {
      '/api': { target: API_PROXY_TARGET, changeOrigin: true },
      '/auth': { target: API_PROXY_TARGET, changeOrigin: true },
      '/healthz': { target: API_PROXY_TARGET, changeOrigin: true },
      '/readyz': { target: API_PROXY_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
