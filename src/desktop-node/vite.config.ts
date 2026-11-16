/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The Tauri dev window loads this server (src-tauri/tauri.conf.json `devUrl`); the port is fixed so it can find it.
export default defineConfig({
  plugins: [react({ compiler: true })],
  clearScreen: false,
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
