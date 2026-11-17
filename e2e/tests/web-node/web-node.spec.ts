import { expect, test, type Browser } from '@playwright/test';
import { createWorkspace, waitFor, type Workspace } from '../../src/api.ts';
import { webNodeUrl } from '../../src/env.ts';

// The web node: a browser tab that enrolls with a code and serves like a phone node (the engine itself needs WebGPU and
// a model, so serving is not covered here).
test.describe.configure({ mode: 'serial' });

let ws: Workspace;
test.beforeAll(async () => {
  ws = await createWorkspace();
});
test.afterAll(async () => {
  await ws?.cleanup();
});

test('is served', async ({ request }) => {
  expect((await request.get(`${webNodeUrl}/healthz`)).ok()).toBe(true);
});

test('opens on the join form', async ({ page }) => {
  await page.goto(webNodeUrl);
  await expect(page.getByLabel('Join code')).toBeVisible();
});

/** A fresh browser context per join: each one is a separate device with its own key. */
async function join(browser: Browser, code: string) {
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: test.info().project.use.ignoreHTTPSErrors,
  });
  const page = await ctx.newPage();
  await page.goto(webNodeUrl);
  await page.getByLabel('Join code').fill(code);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  return { page, ctx };
}

test('a browser tab enrolls as a web node with a code from the pool', async ({ browser }) => {
  const { ctx } = await join(browser, await ws.code());
  const node = await waitFor('the web node to be registered', async () =>
    (await ws.nodes()).find((n) => n.platform === 'web'),
  );
  expect(node.approved).toBe(true);
  await ctx.close();
});

test('a used enrollment code is refused', async ({ browser }) => {
  const code = await ws.code();
  const before = (await ws.nodes()).length;
  const first = await join(browser, code);
  await waitFor('the first join', async () =>
    (await ws.nodes()).length > before ? true : undefined,
  );
  const second = await join(browser, code);
  await expect(second.page.getByText(/not valid, has expired or was already used/)).toBeVisible();
  await first.ctx.close();
  await second.ctx.close();
});
