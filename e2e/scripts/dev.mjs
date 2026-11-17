// Asks for the Dex login (unless E2E_EMAIL / E2E_PASSWORD are set in the environment or in e2e/.env), then runs
// Playwright against E2E_APP_URL (default the local stack). Arguments go to Playwright; the browser window is shown
// (`--headed`) unless `--headless` is given: `pnpm dev --project=cli`, `pnpm dev tests/platform/smoke.spec.ts`.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // no .env file: ask below
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let muted = false;
const write = rl._writeToOutput.bind(rl);
rl._writeToOutput = (s) => write(muted ? (s.includes('\n') ? '\n' : '') : s);

const ask = (question, hidden = false) =>
  new Promise((resolve) => {
    rl.question(question, (answer) => {
      muted = false;
      resolve(answer.trim());
    });
    muted = hidden;
  });

if (!process.stdin.isTTY && !(process.env.E2E_EMAIL && process.env.E2E_PASSWORD)) {
  console.error('No terminal to ask on: set E2E_EMAIL and E2E_PASSWORD.');
  process.exit(1);
}
const args = process.argv.slice(2);
const headless = args.includes('--headless');
const env = { ...process.env };
console.log(`Target: ${env.E2E_APP_URL || 'the local stack'}`);
env.E2E_EMAIL ||= await ask('Dex user (email): ');
env.E2E_PASSWORD ||= await ask('Password: ', true);
rl.close();
if (!env.E2E_EMAIL || !env.E2E_PASSWORD) {
  console.error('An email and a password are required.');
  process.exit(1);
}

const child = spawn(
  'pnpm',
  [
    'exec',
    'playwright',
    'test',
    ...(headless ? [] : ['--headed']),
    ...args.filter((a) => a !== '--headless'),
  ],
  {
    env,
    stdio: 'inherit',
  },
);
child.on('exit', (code) => process.exit(code ?? 1));
