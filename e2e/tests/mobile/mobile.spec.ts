import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { createWorkspace, waitFor, type Workspace } from '../../src/api.ts';
import { apiUrl } from '../../src/env.ts';

// Drives the Android app on an emulator or a USB device with Maestro (flows in maestro/). The workflow boots the
// emulator; locally have `adb devices` list one and `maestro` installed.
//   E2E_MOBILE_APK  an APK to install first (the workflow downloads the newest release's); without it the app must be
//                   installed already. The emulator must reach the stack (local: scripts/start-emulator.sh).
const run = promisify(execFile);
const has = (cmd: string, args: string[]) =>
  run(cmd, args).then(
    (r) => r.stdout,
    () => undefined,
  );

test.describe.configure({ mode: 'serial' });
let ws: Workspace;

test.beforeAll(async () => {
  const devices = (await has('adb', ['devices'])) ?? '';
  const ready = /\tdevice\b/.test(devices) && (await has('maestro', ['--version'])) !== undefined;
  test.skip(!ready && !process.env.CI, 'needs adb with a device and the maestro CLI');
  if (process.env.E2E_MOBILE_APK) await run('adb', ['install', '-r', process.env.E2E_MOBILE_APK]);
  ws = await createWorkspace();
});
test.afterAll(async () => {
  await ws?.cleanup();
});

// Screenshots, recordings and Maestro's debug output land in test-results/maestro (uploaded by the workflow on failure).
async function maestro(flow: string, vars: Record<string, string>) {
  const out = resolve('test-results', 'maestro', flow.replace(/\.yaml$/, ''));
  const args = [
    'test',
    '--test-output-dir',
    out,
    '--debug-output',
    out,
    ...Object.entries(vars).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    resolve('maestro', flow),
  ];
  try {
    return await run('maestro', args, { timeout: 240_000 });
  } catch (e) {
    const { stdout = '', stderr = '' } = e as { stdout?: string; stderr?: string };
    throw new Error(`maestro ${flow} failed:\n${(stdout + stderr).slice(-3000)}`);
  }
}

test('a wrong code is refused with the generic message', async () => {
  await maestro('wrong-code.yaml', { API_URL: apiUrl });
  expect(await ws.nodes()).toHaveLength(0);
});

test('enrolls with a code from the pool', async () => {
  await maestro('enroll.yaml', { CODE: await ws.code(), API_URL: apiUrl });
  const node = await waitFor('the phone to be registered', async () =>
    (await ws.nodes()).find((n) => n.platform === 'android'),
  );
  expect(node.approved).toBe(true);
});
