import { expect, test } from '@playwright/test';
import { createWorkspace, waitFor, type Workspace } from '../../src/api.ts';
import { isLocalStack, webNodeUrl } from '../../src/env.ts';
import { signIn } from './support.ts';

// Setup goes through the API (fast, independent of the UI); the browser checks what an operator sees and does.
test.describe.configure({ mode: 'serial' });

let ws: Workspace;
test.beforeAll(async () => {
  ws = await createWorkspace();
});
test.afterAll(async () => {
  await ws?.cleanup();
});

test('signed-in user sees the organisation and its pool', async ({ page }) => {
  await signIn(page);
  await page.goto('/organisations');
  await expect(page.getByText(ws.org.name)).toBeVisible();
  await page.goto(`/organisations/${ws.org.id}/pools`);
  await expect(page.getByText(ws.pool.name)).toBeVisible();
});

async function joinWebNode(browser: import('@playwright/test').Browser, code: string) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: isLocalStack });
  const page = await ctx.newPage();
  await page.goto(webNodeUrl);
  await page.getByLabel('Join code').fill(code);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  return { page, ctx };
}

test('a browser tab enrolls as a web node with a code from the pool', async ({ browser }) => {
  const { ctx } = await joinWebNode(browser, await ws.code());
  const node = await waitFor('the web node to be registered', async () =>
    (await ws.nodes()).find((n) => n.platform === 'web'),
  );
  expect(node.approved).toBe(true);
  await ctx.close();
});

test('a used enrollment code is refused', async ({ browser }) => {
  const code = await ws.code();
  const before = (await ws.nodes()).length;
  const first = await joinWebNode(browser, code);
  await waitFor('the first join', async () =>
    (await ws.nodes()).length > before ? true : undefined,
  );
  const second = await joinWebNode(browser, code);
  await expect(second.page.getByText(/not valid, has expired or was already used/)).toBeVisible();
  await first.ctx.close();
  await second.ctx.close();
});
