// Local runs: asks for the Dex login (unless E2E_EMAIL / E2E_PASSWORD are already set), then runs Playwright against
// the local stack. Arguments go to Playwright: `pnpm dev --project=cli`, `pnpm dev tests/platform/smoke.spec.ts`.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

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
const env = { ...process.env };
env.E2E_EMAIL ||= await ask('Dex user (email): ');
env.E2E_PASSWORD ||= await ask('Password: ', true);
rl.close();
if (!env.E2E_EMAIL || !env.E2E_PASSWORD) {
  console.error('An email and a password are required.');
  process.exit(1);
}

const child = spawn('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
  env,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
