import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { inTauri } from './ipc';

/**
 * `fetch` for the control plane. The control plane has no CORS (and must not get any), and this app's webview is a
 * different origin, so inside the app requests go through Tauri's HTTP client (made by Rust, no CORS, normal TLS
 * validation). In a plain browser (`pnpm dev`) and in tests it is the global `fetch`, looked up at call time.
 */
export const httpFetch: typeof fetch = (input, init) =>
  inTauri() ? tauriFetch(input, init) : globalThis.fetch(input, init);
