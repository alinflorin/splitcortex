import { fileURLToPath } from 'node:url';

// e2e/.env (git-ignored, see .env.example) fills in variables that are not already set in the environment.
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  // no .env file
}

// Where the suites point. Defaults to the local stack (Tilt); the e2e workflow sets E2E_APP_URL to staging.
//   E2E_APP_URL       web app origin (default the local stack, https://app.splitcortex.127.0.0.1.nip.io)
//   E2E_DEX_URL       default: the app host with `app.` -> `dex.` (same rule as the web app)
//   E2E_WEB_NODE_URL  default: the app host with `app.` -> `web-node.`
//   E2E_EMAIL / E2E_PASSWORD  the Dex password user (Google login cannot be scripted). Local: any user of
//                    values-local.yaml (from e2e/.env, else `pnpm dev` asks). Stg: the `stg` environment secrets of the same names.
const origin = (url: string) => new URL(url).origin;

export const appUrl = origin(process.env.E2E_APP_URL || 'https://app.splitcortex.127.0.0.1.nip.io');

function sibling(prefix: string, keepPort: boolean): string {
  const u = new URL(appUrl);
  u.hostname = u.hostname.replace(/^app\./, `${prefix}.`);
  if (!keepPort) u.port = '';
  return u.origin;
}

export const dexUrl = origin(process.env.E2E_DEX_URL || sibling('dex', false));
export const webNodeUrl = origin(process.env.E2E_WEB_NODE_URL || sibling('web-node', true));
/** The control plane lives at /api on the web app host. */
export const apiUrl = `${appUrl}/api`;

/** The local stack uses a throwaway root CA the test browser does not trust. */
export const isLocalStack = new URL(appUrl).hostname.endsWith('.nip.io');

export function credentials(): { user: string; password: string } {
  const user = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!user || !password) throw new Error('Set E2E_EMAIL and E2E_PASSWORD (a Dex password user).');
  return { user, password };
}
