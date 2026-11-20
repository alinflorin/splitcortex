import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createWorkspace, type Workspace } from '../../src/api.ts';
import { apiUrl } from '../../src/env.ts';
import { enrollDevice } from '../../src/perf/fake-node.ts';
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
  await expect(page.getByRole('main').getByText(`E2E UI ${slug}`)).toBeVisible();
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

test('the audit log page lists what was done in the organisation', async ({ page }) => {
  const org = await ws.cp.createOrg();
  created.push(org.id);
  await ws.cp.createPool(org.id, 'ui-audit-pool');
  await signIn(page);
  await page.goto(`/organisations/${org.id}/audit`);
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  // Rows are written just after each API response; the page shows them newest first.
  await expect(page.getByText('Pool created').first()).toBeVisible();
  await expect(page.getByText('Organisation created').first()).toBeVisible();
  // The category filter narrows the list.
  await page.getByRole('combobox', { name: 'Category' }).click();
  await page.getByRole('option', { name: 'Pools' }).click();
  await expect(page.getByText('Pool created').first()).toBeVisible();
  await expect(page.getByText('Organisation created')).toHaveCount(0);
  // The outcome filter: nothing was denied.
  await page.getByRole('combobox', { name: 'Outcome' }).click();
  await page.getByRole('option', { name: 'Denied' }).click();
  await expect(page.getByText('Nothing recorded for these filters.')).toBeVisible();
});

test('the audit log can be exported as CSV and as JSON', async ({ page }) => {
  const org = await ws.cp.createOrg();
  created.push(org.id);
  await ws.cp.createPool(org.id, 'ui-export-pool');
  await signIn(page);
  await page.goto(`/organisations/${org.id}/audit`);
  await expect(page.getByText('Pool created').first()).toBeVisible();

  const csvDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toMatch(/^audit-log-\d{4}-\d\d-\d\d\.csv$/);
  const csvText = await readFile((await csv.path())!, 'utf8');
  expect(csvText.split('\r\n')[0]).toBe(
    'occurredAt,source,actorType,actorId,action,entityType,entityId,outcome,ip,metadata',
  );
  expect(csvText).toContain('pool.create');

  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const json = await jsonDownload;
  expect(json.suggestedFilename()).toMatch(/^audit-log-\d{4}-\d\d-\d\d\.json$/);
  const rows = JSON.parse(await readFile((await json.path())!, 'utf8')) as { action: string }[];
  expect(rows.map((r) => r.action)).toContain('pool.create');
});

test('adds an embedding model with its type and marks it on the card', async ({ page }) => {
  const org = await ws.cp.createOrg();
  created.push(org.id);
  await signIn(page);
  await page.goto(`/organisations/${org.id}/models`);
  await page.getByRole('button', { name: 'Add model' }).first().click();
  // Chat is the default type.
  await expect(page.getByRole('radio', { name: 'Chat' })).toBeChecked();
  await page.getByLabel(/^Name/).fill('ui-embedding');
  await page
    .getByLabel(/Hugging Face link/)
    .fill('https://huggingface.co/e2e-nonexistent/e2e-embed/resolve/main/e2e-embed.litertlm');
  await page.getByRole('radio', { name: 'Embeddings' }).check();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  // The file does not exist, so the download fails in the background; the model and its kind are what is checked.
  await expect(page.getByText('ui-embedding')).toBeVisible();
  await expect(page.getByText(/^Embeddings ·/)).toBeVisible();
  const [model] = (await ws.cp.send('GET', `/organisations/${org.id}/models`)).body as {
    name: string;
    kind: string;
  }[];
  expect(model).toMatchObject({ name: 'ui-embedding', kind: 'embedding' });
});

test('creates several enrollment codes at once and cancels the unused ones on close', async ({
  page,
}) => {
  const org = await ws.cp.createOrg();
  created.push(org.id);
  const pool = await ws.cp.createPool(org.id, 'ui-bulk-pool');
  await signIn(page);
  await page.goto(`/organisations/${org.id}/pools/${pool.id}`);
  await page.getByRole('button', { name: 'Add many devices' }).click();
  await page.getByLabel('Number of devices').fill('51');
  await expect(page.getByText('Enter a whole number from 1 to 50.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create codes' })).toBeDisabled();
  await page.getByLabel('Number of devices').fill('3');
  await page.getByRole('button', { name: 'Create codes' }).click();

  const rows = page.getByTestId('bulk-codes').getByText(/^[0-9A-Z]{4}-[0-9A-Z]{6}$/);
  await expect(rows).toHaveCount(3);
  await expect(page.getByText('0 of 3 devices enrolled')).toBeVisible();
  expect(await ws.cp.listEnrollments(org.id, pool.id)).toHaveLength(3);

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect
    .poll(async () => (await ws.cp.listEnrollments(org.id, pool.id)).length, { timeout: 15_000 })
    .toBe(0);
});

test('the node page has a Restart button that is disabled while the device is offline', async ({
  page,
}) => {
  const org = await ws.cp.createOrg();
  created.push(org.id);
  const pool = await ws.cp.createPool(org.id, 'ui-restart-pool');
  // Enrolled but never connected: the device exists and is offline.
  const device = await enrollDevice(
    apiUrl,
    await ws.cp.createEnrollmentCode(org.id, pool.id),
    'ui-offline-device',
  );
  await signIn(page);
  await page.goto(`/organisations/${org.id}/nodes/${device.nodeId}`);
  await expect(page.getByRole('heading', { name: 'ui-offline-device' })).toBeVisible();
  // Visible to the owner, but there is nothing to restart.
  await expect(page.getByRole('button', { name: 'Restart', exact: true })).toBeDisabled();
});

test('the metrics page renders the charts of an organisation', async ({ page }) => {
  const org = await ws.cp.createOrg();
  created.push(org.id);
  await signIn(page);
  await page.goto(`/organisations/${org.id}/metrics`);
  await expect(page.getByText('Requests', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Time to first token').first()).toBeVisible();
  await expect(page.getByText('CPU', { exact: true }).first()).toBeVisible();
  // Switching the period keeps the page working (no data yet in a new organisation is fine).
  await page.getByRole('combobox', { name: 'Period' }).click();
  await page.getByRole('option', { name: 'Last 15 minutes' }).click();
  await expect(page.getByText('Requests', { exact: true }).first()).toBeVisible();
});

test('account deletion is refused while the account is the only owner of an organisation', async ({
  page,
}) => {
  // ws.org (made in beforeAll) has this login as its only owner. Confirming must therefore fail and change nothing;
  // the success path would remove the shared e2e login from every suite's organisation (see tests/api/account.spec.ts).
  await signIn(page);
  await page.goto('/user-settings');
  await expect(page.getByRole('heading', { name: 'Account settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(page.getByText('Delete your account?')).toBeVisible();
  await page.getByRole('button', { name: 'Delete' }).last().click();
  await expect(page.getByText('Account deleted')).toHaveCount(0);
  expect((await ws.cp.listOrgs()).map((o) => o.id)).toContain(ws.org.id);
});
