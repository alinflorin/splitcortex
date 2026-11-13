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

export default defineConfig({
  // Experimental Rust port of React Compiler (oxc-transform-react).
  plugins: [react({ compiler: true }), healthz],
  server: {
    host: true,
    port: 5173,
    // Allow the nip.io dev hostnames (app.splitcortex.127.0.0.1.nip.io).
    allowedHosts: ['.nip.io', 'localhost'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
