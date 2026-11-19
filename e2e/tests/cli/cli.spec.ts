import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { createWorkspace, waitFor, type Workspace } from '../../src/api.ts';
import { appUrl } from '../../src/env.ts';

// Drives the real splitcortex-node binary against a deployed stack. E2E_CLI_BIN points at it (the workflow installs the
// newest cli-node release with install.sh; locally: `cargo build --release` in src/cli-node, the default below).
const bin = resolve(process.env.E2E_CLI_BIN ?? '.cache/cli-node/splitcortex-node');
test.skip(!existsSync(bin) && !process.env.CI, `no CLI binary at ${bin} (set E2E_CLI_BIN)`);
test.describe.configure({ mode: 'serial' });

const run = promisify(execFile);
let home: string;
let ws: Workspace;
let serving: ChildProcess | undefined;
const env = () => ({ ...process.env, SPLITCORTEX_HOME: home, SPLITCORTEX_URL: appUrl });
const cli = (...args: string[]) => run(bin, args, { env: env() });

test.beforeAll(async () => {
  expect(existsSync(bin), `no CLI binary at ${bin} (set E2E_CLI_BIN)`).toBe(true);
  home = mkdtempSync(join(tmpdir(), 'splitcortex-cli-e2e-'));
  ws = await createWorkspace();
});
test.afterAll(async () => {
  serving?.kill('SIGTERM');
  await ws?.cleanup();
  if (home) rmSync(home, { recursive: true, force: true });
});

test('prints its version', async () => {
  expect((await cli('--version')).stdout).toMatch(/splitcortex-node \d+\.\d+\.\d+/);
});

test('is not enrolled at first', async () => {
  expect((await cli('status')).stdout).toContain('Not enrolled');
});

test('refuses a wrong code', async () => {
  await expect(cli('join', '--code', 'ZZZZ-ZZZZZZ')).rejects.toMatchObject({
    stderr: expect.stringMatching(/invalid, expired or used up code/),
  });
});

test('enrolls with a code from the pool and shows up in the control plane', async () => {
  const out = (await cli('join', '--code', await ws.code())).stdout;
  expect(out).toContain('Enrolled as');
  expect(out).toContain(`Pool: ${ws.pool.name}`);
  expect((await cli('status')).stdout).toContain('Approved:    yes');
  const nodes = await ws.nodes();
  expect(nodes).toHaveLength(1);
  expect(nodes[0]).toMatchObject({ platform: 'cli', approved: true });
});

test('refuses a second join while enrolled', async () => {
  await expect(cli('join', '--code', 'ABCD-EFGHJK')).rejects.toMatchObject({
    stderr: expect.stringMatching(/Already enrolled/),
  });
});

test('connects to the gateway and goes online, then offline when stopped', async () => {
  serving = spawn(bin, ['run'], { env: env(), stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  serving.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
  try {
    await waitFor(
      'the node to be online',
      async () => {
        if (serving?.exitCode !== null)
          throw new Error(`run exited early:\n${stderr.slice(-2000)}`);
        return (await ws.nodes()).find((n) => n.status === 'online');
      },
      90_000,
    );
  } finally {
    serving.kill('SIGTERM');
  }
  await waitFor(
    'the node to go offline after SIGTERM',
    async () => (await ws.nodes()).find((n) => n.status === 'offline'),
    60_000,
  );
  serving = undefined;
});

test('forgets the enrollment on leave', async () => {
  await cli('leave');
  expect((await cli('status')).stdout).toContain('Not enrolled');
});
