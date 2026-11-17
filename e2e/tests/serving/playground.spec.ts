import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { bin, MODEL, startServingNode, type ServingNode } from '../../src/serving-node.ts';
import { signIn } from '../platform/support.ts';

// The web app's Playground page: the user pastes an API key and chats with the pool through `/v1` on the app's own
// origin (same origin, so no CORS on the gateway). Needs the chart's `gateway.appIngress` route, so it fails against a
// stack deployed before that existed. Assertions are about structure, never about what the model says.
test.skip(!existsSync(bin) && !process.env.CI, `no CLI binary at ${bin} (set E2E_CLI_BIN)`);
test.describe.configure({ mode: 'serial', timeout: 300_000 });

let node: ServingNode;
test.beforeAll(async () => {
  node = await startServingNode();
  await node.ready();
});
test.afterAll(async () => {
  await node?.stop();
});

test('a rejected key shows the gateway error and no chat', async ({ page }) => {
  await signIn(page);
  await page.goto('/playground');
  await page.getByLabel(/API key/).fill('sc_not-a-key');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText('Incorrect API key provided.')).toBeVisible();
  await expect(page.getByLabel('Message')).toHaveCount(0);
});

test('chats with the pool through the app origin, streams the reply and keeps the history only in the page', async ({
  page,
}) => {
  const key = await node.ws.apiKey();
  await signIn(page);

  // The Home card opens the Playground in a new tab.
  await page.goto('/');
  const popup = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Open the Playground' }).click();
  const tab = await popup;
  await expect(tab).toHaveURL(/\/playground$/);
  await tab.close();

  // The browser must talk to the app origin, never to the gateway host.
  const gatewayCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/v1/')) gatewayCalls.push(new URL(r.url()).origin);
  });

  await page.goto('/playground');
  await page.getByLabel(/API key/).fill(key.secret);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('combobox', { name: 'Model' })).toHaveValue(MODEL);

  await page.getByLabel('Max tokens').fill('8');
  await page.getByLabel('Message').fill('Say hello.');
  await page.getByRole('button', { name: 'Send' }).click();

  // Your message, then an assistant card with some text and the timing line.
  await expect(page.getByText('Say hello.', { exact: true })).toBeVisible();
  const reply = page.locator('article').filter({ hasText: 'Assistant' });
  await expect(reply).toHaveCount(1);
  await expect(reply.getByText(/\d+ tokens/)).toBeVisible({ timeout: 120_000 });
  await expect(reply.locator('p').first()).not.toBeEmpty();

  expect(gatewayCalls.length).toBeGreaterThan(0);
  expect(new Set(gatewayCalls)).toEqual(new Set([new URL(page.url()).origin]));

  // Nothing is stored: a reload leaves an empty page, and the key has to be pasted again.
  await page.reload();
  await expect(page.getByLabel('Message')).toHaveCount(0);
  await expect(page.getByLabel(/API key/)).toHaveValue('');
});
