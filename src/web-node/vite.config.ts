/// <reference types="vitest/config" />
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
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

// LiteRT-LM's JS package loads its WASM from a jsDelivr URL by default. No CDNs, ever: the runtime ships with the app
// and `loadLiteRtLm('/litertlm/')` (src/engine/litert.ts) points at this copy.
const litertWasm: Plugin = (() => {
  const dir = join(
    dirname(createRequire(import.meta.url).resolve('@litert-lm/core/package.json')),
    'wasm',
  );
  const files = () => readdirSync(dir).filter((f) => /\.(js|wasm)$/.test(f));
  return {
    name: 'litertlm-wasm',
    configureServer(server) {
      server.middlewares.use('/litertlm/', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0]!.replace(/^\//, '');
        if (!files().includes(name)) return next();
        res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(readFileSync(join(dir, name)));
      });
    },
    generateBundle() {
      for (const f of files()) {
        this.emitFile({ type: 'asset', fileName: `litertlm/${f}`, source: readFileSync(join(dir, f)) });
      }
    },
  };
})();

export default defineConfig({
  // Experimental Rust port of React Compiler (oxc-transform-react).
  plugins: [react({ compiler: true }), healthz, version, litertWasm],
  server: {
    host: true,
    port: 5174,
    // Allow the nip.io dev hostnames (web-node.splitcortex.127.0.0.1.nip.io).
    allowedHosts: ['.nip.io', 'localhost'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
