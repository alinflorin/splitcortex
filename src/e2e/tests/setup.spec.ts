import { expect, test, type Page } from '@playwright/test';
import { cp, poolNodes } from '../lib/api';
import { login } from '../lib/auth';
import { authFile, baseUrl, CHAT_MODEL, EMBEDDING_MODEL, users } from '../lib/env';
import { saveState } from '../lib/state';

// Everything the node specs need, created through the web app like a customer would: organisation, the two fixed
// models (chat + embeddings, from Hugging Face), a pool for each, and an API key. The organisation, models and pools
// are kept between runs (the models are downloaded from Hugging Face once, then reused); only nodes and the API key
// are per run. One browser sign-in per E2E user.
test('sign in every E2E user', async ({ browser }) => {
  for (const [i, u] of users().entries()) {
    const context = await browser.newContext();
    await login(await context.newPage(), u.email, u.password);
    await context.storageState({ path: authFile(i) });
    await context.close();
  }
});

const ORG_NAME = 'e2e';

interface Named {
  id: string;
  name: string;
  status?: string;
}

async function list(page: Page, path: string): Promise<Named[]> {
  const res = await cp(page, 'GET', path);
  expect(res.ok(), path).toBe(true);
  return (await res.json()) as Named[];
}

async function ensureModel(
  page: Page,
  orgId: string,
  name: string,
  url: string,
  embedding: boolean,
) {
  const existing = (await list(page, `/organisations/${orgId}/models`)).find(
    (m) => m.name === name,
  );
  if (existing?.status === 'failed') {
    await cp(page, 'DELETE', `/organisations/${orgId}/models/${existing.id}`);
  }
  if (!existing || existing.status === 'failed') {
    await page.goto(`${baseUrl()}/organisations/${orgId}/models`);
    await page.getByRole('button', { name: 'Add model' }).first().click();
    const dialog = page.getByRole('alertdialog'); // AddModelDialog is modalType="alert"
    if (embedding) await dialog.getByRole('radio', { name: 'Embeddings' }).check();
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Hugging Face link').fill(url);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Model added.').first()).toBeVisible();
    await page.keyboard.press('Escape');
  }
  // The control plane downloads it into object storage in the background (only the first time ever).
  await expect
    .poll(
      async () => {
        const m = (await list(page, `/organisations/${orgId}/models`)).find((x) => x.name === name);
        if (m?.status === 'failed') throw new Error(`model ${name} failed to download`);
        return m?.status;
      },
      { timeout: 15 * 60_000, intervals: [5_000] },
    )
    .toBe('ready');
}

async function ensurePool(page: Page, orgId: string, name: string, model: string): Promise<string> {
  let poolId = (await list(page, `/organisations/${orgId}/pools`)).find((p) => p.name === name)?.id;
  if (!poolId) {
    await page.goto(`${baseUrl()}/organisations/${orgId}/pools`);
    await page.getByRole('button', { name: 'New pool' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Pool created.').first()).toBeVisible();
    poolId = (await list(page, `/organisations/${orgId}/pools`)).find((p) => p.name === name)?.id;
    expect(poolId, `pool ${name} exists after creating it`).toBeTruthy();
  }

  // The pool may exist without its model (an earlier run stopped between the two steps): always check, never assume.
  const served = await list(page, `/organisations/${orgId}/pools/${poolId}/models`);
  if (!served.some((m) => m.name === model)) {
    await page.goto(`${baseUrl()}/organisations/${orgId}/pools/${poolId}`);
    // The pool page has several dropdowns (metrics range, group by…); the model picker is the one with this placeholder.
    await page.getByRole('combobox').filter({ hasText: 'Pick the model to serve' }).click();
    await page.getByRole('option', { name: new RegExp(model) }).click();
    await page.getByRole('button', { name: 'Set model' }).click();
    await expect(page.getByText('The pool now serves this model.').first()).toBeVisible();
  }
  const after = await list(page, `/organisations/${orgId}/pools/${poolId}/models`);
  expect(
    after.map((m) => m.name),
    `pool ${name} serves ${model}`,
  ).toEqual([model]);
  return poolId!;
}

test('find or create the organisation, models, pools; new API key', async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  const context = await browser.newContext({ storageState: authFile(0) });
  const page = await context.newPage();
  await page.goto(`${baseUrl()}/organisations`);

  let org = (await list(page, '/organisations')).find((o) => o.name === ORG_NAME);
  if (!org) {
    await page.getByRole('button', { name: 'New organisation' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(ORG_NAME);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Organisation created.').first()).toBeVisible();
    org = (await list(page, '/organisations')).find((o) => o.name === ORG_NAME);
  }
  const orgId = org!.id;

  await ensureModel(page, orgId, CHAT_MODEL.name, CHAT_MODEL.url, false);
  await ensureModel(page, orgId, EMBEDDING_MODEL.name, EMBEDDING_MODEL.url, true);
  const chatPoolId = await ensurePool(page, orgId, 'e2e-chat', CHAT_MODEL.name);
  const embedPoolId = await ensurePool(page, orgId, 'e2e-embeddings', EMBEDDING_MODEL.name);

  // A failed earlier run may have left devices behind: start from empty pools.
  for (const poolId of [chatPoolId, embedPoolId]) {
    for (const n of await poolNodes(page, orgId, poolId)) {
      await cp(page, 'DELETE', `/organisations/${orgId}/nodes/${n.id}`);
    }
  }

  const keyName = `e2e-${Date.now().toString(36)}`;
  await page.goto(`${baseUrl()}/organisations/${orgId}/api-keys`);
  await page.getByRole('button', { name: 'New API key' }).first().click();
  await page.getByRole('dialog').getByLabel('Name').fill(keyName);
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  // Role + name: the alert dialog itself is also labelled "Copy your API key" (by its title).
  const secret = page.getByRole('textbox', { name: 'Copy your API key' });
  await expect(secret).toBeVisible();
  const apiKey = await secret.inputValue();
  expect(apiKey.length).toBeGreaterThan(16);
  await page.getByRole('button', { name: 'Done' }).click();
  const apiKeyId = (await list(page, `/organisations/${orgId}/api-keys`)).find(
    (k) => k.name === keyName,
  )!.id;

  saveState({ orgId, orgName: ORG_NAME, chatPoolId, embedPoolId, apiKey, apiKeyId });
  await context.close();
});
