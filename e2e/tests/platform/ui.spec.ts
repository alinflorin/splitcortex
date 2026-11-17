import { expect, test } from '@playwright/test';
import { createWorkspace, type Workspace } from '../../src/api.ts';
import { signIn } from './support.ts';

// What an operator does in the web app, through the real UI. Setup that is not the point of a test goes through the API.
test.describe.configure({ mode: 'serial' });

let ws: Workspace;
const created: string[] = []; // ids of organisations made through the UI, deleted at the end
test.beforeAll(async () => {
  ws = await createWorkspace();
});
test.afterAll(async () => {
  for (const id of created) await ws?.cp.deleteOrg(id).catch(() => undefined);
  await ws?.cleanup();
});

test('creates an organisation', async ({ page }) => {
  const slug = `e2e-ui-${Date.now().toString(36)}`;
  await signIn(page);
  await page.getByRole('button', { name: 'New organisation' }).click();
  await page.getByLabel('Name').fill(`E2E UI ${slug}`);
  await page.getByLabel('Slug').fill(slug);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText(`E2E UI ${slug}`)).toBeVisible();
  const org = (await ws.cp.listOrgs()).find((o) => o.slug === slug);
  expect(org).toBeTruthy();
  created.push(org!.id);
});

test('creates a pool that requires approval', async ({ page }) => {
  await signIn(page);
  await page.goto(`/organisations/${ws.org.id}/pools`);
  await page.getByRole('button', { name: 'New pool' }).first().click();
  await page.getByLabel('Name').fill('ui-approval-pool');
  await page.getByLabel('Require admin approval').check();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText('ui-approval-pool')).toBeVisible();
  await expect(page.getByText('Approval required')).toBeVisible();
});

test('shows an enrollment code and QR for a pool', async ({ page }) => {
  await signIn(page);
  await page.goto(`/organisations/${ws.org.id}/pools/${ws.pool.id}`);
  await page.getByRole('button', { name: 'Add device' }).first().click();
  await expect(page.getByText(/\b[0-9A-Z]{4}-[0-9A-Z]{6}\b/)).toBeVisible();
  await expect(page.getByAltText('QR code with the enrollment link')).toBeVisible();
  expect(await ws.cp.listEnrollments(ws.org.id, ws.pool.id)).toHaveLength(1);
});

test('creates an API key, shows its secret once, then revokes it', async ({ page }) => {
  await signIn(page);
  await page.goto(`/organisations/${ws.org.id}/api-keys`);
  await page.getByRole('button', { name: 'New API key' }).first().click();
  await page.getByLabel('Name').fill('ui-key');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page.getByText('Copy your API key')).toBeVisible();
  const secret = await page
    .locator('input')
    .evaluateAll((els) =>
      (els as HTMLInputElement[]).map((e) => e.value).find((v) => v.startsWith('sc_')),
    );
  expect(secret).toMatch(/^sc_/);
  await page.getByRole('button', { name: 'Done' }).click();

  // The list shows the key by name and prefix; the full secret is gone from the page, even after a reload.
  await expect(page.getByText('ui-key')).toBeVisible();
  await page.reload();
  await expect(page.getByText('ui-key')).toBeVisible();
  expect(await page.content()).not.toContain(secret!);

  await page.getByRole('button', { name: 'Revoke' }).first().click();
  await page
    .getByRole('button', { name: /Revoke|Confirm/ })
    .last()
    .click();
  await expect(page.getByText('Revoked', { exact: true }).first()).toBeVisible();
});

test('deletes a pool after confirming', async ({ page }) => {
  // An organisation of its own with one pool, so the only Delete button is the one under test.
  const org = await ws.cp.createOrg();
  created.push(org.id);
  const pool = await ws.cp.createPool(org.id, 'ui-delete-me');
  await signIn(page);
  await page.goto(`/organisations/${org.id}/pools`);
  await expect(page.getByText('ui-delete-me')).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).click();
  // The confirm dialog renders after the page in the DOM, so its button is the last one.
  await page.getByRole('button', { name: 'Delete' }).last().click();
  await expect(page.getByText('ui-delete-me')).toHaveCount(0);
  expect(await ws.cp.send('GET', `/organisations/${org.id}/pools/${pool.id}`)).toMatchObject({
    status: 404,
  });
});
