import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { remote } from 'webdriverio';
import { createWorkspace, waitFor, type Workspace } from '../../src/api.ts';
import { apiUrl } from '../../src/env.ts';

// Drives the real desktop app through tauri-driver (WebDriver; Linux and Windows, macOS has no driver). Playwright is
// only the runner here: the app is controlled with WebdriverIO's `remote()`.
//   E2E_DESKTOP_BIN  the app executable (the workflow installs the newest release's .deb; locally
//                    `pnpm tauri build --no-bundle` in src/desktop-node)
//   TAURI_DRIVER     tauri-driver executable (`cargo install tauri-driver --locked`), default: from PATH
// Linux also needs `webkit2gtk-driver` (WebKitWebDriver) and a display (xvfb-run).
const application = resolve(
  process.env.E2E_DESKTOP_BIN ??
    '../src/desktop-node/src-tauri/target/release/splitcortex-desktop-node',
);
test.skip(
  process.platform === 'darwin' || (!existsSync(application) && !process.env.CI),
  `no desktop app at ${application} (set E2E_DESKTOP_BIN), or macOS`,
);
test.describe.configure({ mode: 'serial' });

let ws: Workspace;
let driver: ChildProcess;
let sandbox: string;
let app: WebdriverIO.Browser;

test.beforeAll(async () => {
  ws = await createWorkspace();
  // A fresh app data dir per run, so a developer's real enrollment is never touched (Linux: XDG dirs).
  sandbox = mkdtempSync(join(tmpdir(), 'splitcortex-desktop-e2e-'));
  driver = spawn(process.env.TAURI_DRIVER ?? 'tauri-driver', [], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      XDG_DATA_HOME: join(sandbox, 'data'),
      XDG_CONFIG_HOME: join(sandbox, 'config'),
      XDG_CACHE_HOME: join(sandbox, 'cache'),
    },
  });
  await new Promise((r) => setTimeout(r, 2_000));
  app = await remote({
    hostname: '127.0.0.1',
    port: 4444,
    logLevel: 'warn',
    capabilities: { 'tauri:options': { application } } as WebdriverIO.Capabilities,
  });
});

test.afterAll(async () => {
  await app?.deleteSession().catch(() => undefined);
  driver?.kill();
  await ws?.cleanup();
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

/** Waits for text on screen; on failure shows what the window said and attaches a screenshot. */
async function expectOnScreen(text: RegExp) {
  const body = () => app.$('body').getText();
  try {
    await app.waitUntil(async () => text.test(await body()), { timeout: 30_000, interval: 500 });
  } catch {
    await test.info().attach('window', {
      body: Buffer.from(await app.takeScreenshot(), 'base64'),
      contentType: 'image/png',
    });
    throw new Error(`Expected ${text} on screen, the window says:\n${await body()}`);
  }
}

const urlInput = () => app.$('input[placeholder="https://app.example.com/api"]');
const codeInput = () => app.$('input[placeholder="XXXX-XXXXXX"]');

test('opens on the join form', async () => {
  await app.$('button=Join').waitForExist({ timeout: 30_000 });
  expect(await app.getTitle()).toBe('SplitCortex Node');
});

test('rejects a wrong code', async () => {
  await urlInput().setValue(apiUrl);
  await codeInput().setValue('ZZZZZZZZZZ');
  await app.$('button=Join').click();
  await expectOnScreen(/not valid, has expired or was already used/);
});

test('enrolls with a code from the pool', async () => {
  await codeInput().clearValue();
  await codeInput().setValue((await ws.code()).replace('-', ''));
  await app.$('button=Join').click();
  const node = await waitFor('the desktop node to be registered', async () =>
    (await ws.nodes()).find((n) => n.platform === 'desktop'),
  );
  expect(node.approved).toBe(true);
  await app.$('button=Join').waitForExist({ reverse: true, timeout: 30_000 });
});
