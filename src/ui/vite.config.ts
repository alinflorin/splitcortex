import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Experimental Rust port of React Compiler (oxc-transform-react).
  plugins: [react({ compiler: true })],
  server: {
    host: true,
    port: 5173,
    // Allow the nip.io dev hostnames (app.splitcortex.127.0.0.1.nip.io).
    allowedHosts: ['.nip.io', 'localhost'],
  },
});
