/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Same probe endpoint as the Caddy image, so the chart's probes work against the dev server too.
const healthz: Plugin = {
  name: 'healthz',
  configureServer(server) {
    server.middlewares.use('/healthz', (_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    });
  },
};

// Same /version.json as the Caddy image (the chart sets APP_VERSION on the dev Deployment too).
const version: Plugin = {
  name: 'version',
  configureServer(server) {
    server.middlewares.use('/version.json', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ version: process.env.APP_VERSION || 'dev' }));
    });
  },
};

export default defineConfig({
  // Experimental Rust port of React Compiler (oxc-transform-react).
  plugins: [react({ compiler: true }), healthz, version],
  server: {
    host: true,
    port: 5173,
    // Allow the local dev hostnames (app.local.splitcortex.com).
    allowedHosts: ['.local.splitcortex.com', '.nip.io', 'localhost'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
