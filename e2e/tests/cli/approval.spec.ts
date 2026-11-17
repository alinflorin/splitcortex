import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { createWorkspace, type Workspace } from '../../src/api.ts';
import { appUrl } from '../../src/env.ts';

// A pool that requires approval: the device enrolls but stays pending until an admin approves it.
const bin = resolve(process.env.E2E_CLI_BIN ?? '../src/cli-node/target/release/splitcortex-node');
test.skip(!existsSync(bin) && !process.env.CI, `no CLI binary at ${bin} (set E2E_CLI_BIN)`);
test.describe.configure({ mode: 'serial' });

const run = promisify(execFile);
let home: string;
let ws: Workspace;
const cli = (...args: string[]) =>
  run(bin, args, { env: { ...process.env, SPLITCORTEX_HOME: home, SPLITCORTEX_URL: appUrl } });

test.beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'splitcortex-cli-e2e-'));
  ws = await createWorkspace({ requireApproval: true });
});
test.afterAll(async () => {
  await ws?.cleanup();
  if (home) rmSync(home, { recursive: true, force: true });
});

test('a device of an approval pool enrolls as pending, then an admin approves it', async () => {
  const out = (await cli('join', '--code', await ws.code())).stdout;
  expect(out).toContain('Enrolled as');
  expect((await cli('status')).stdout).toContain('Approved:    no');
  const [pending] = await ws.nodes();
  expect(pending).toMatchObject({ approved: false, status: 'pending' });

  await ws.cp.approveNode(ws.org.id, pending!.id);
  expect((await cli('status')).stdout).toContain('Approved:    yes');
  expect((await ws.nodes())[0]!.approved).toBe(true);
});
