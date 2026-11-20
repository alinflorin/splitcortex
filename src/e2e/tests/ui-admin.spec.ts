import { expect, test, type Page } from '@playwright/test';
import { api, createOrg, deleteOrg, gateway, uniq, userPage } from '../lib/api';
import { dialogsClosed } from '../lib/ui';
import { authFile, baseUrl } from '../lib/env';

// The admin screens, as an admin uses them, in a throw-away organisation (created and deleted here): models (form
// validation, an upload through the control plane into object storage, serving it from a pool, deleting it), API keys
// (create with scope, limits and expiry, use the key against the gateway, edit limits and expiry, revoke), settings
// (rename, organisation limits, delete), the audit log (what the steps above wrote, filters, export), usage and
// metrics. No device and no Hugging Face download: the model is a tiny uploaded file the pool only has to *serve*.
test.describe.configure({ mode: 'serial' });
test.use({ storageState: authFile(0) });

let admin: Page;
let org: { id: string; slug: string; name: string };
let poolId: string;
const poolName = `ui-admin-${uniq()}`;
const MODEL = 'tiny-e2e';
const orgUrl = (path = '') => `${baseUrl()}/organisations/${org.id}${path}`;
const orgApi = (path = '') => `/organisations/${org.id}${path}`;

test.beforeAll(async ({ browser }) => {
  admin = await userPage(browser, 0);
  org = await createOrg(admin, 'adm');
  const pool = await api<{ id: string }>(admin, 'POST', orgApi('/pools'), { name: poolName });
  expect(pool.status).toBe(201);
  poolId = pool.body.id;
});

test.afterAll(async () => {
  await deleteOrg(admin, org.id);
  await admin.context().close();
});

test('models: the form validates, nothing is sent when it is wrong', async ({ page }) => {
  await page.goto(orgUrl('/models'));
  await expect(page.getByText('No models yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Add model' }).first().click();
  const dialog = page.getByRole('alertdialog');

  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByText('This field is required.').first()).toBeVisible();

  await dialog.getByLabel('Name').fill('bad-link');
  await dialog.getByLabel('Hugging Face link').fill('https://example.com/m.litertlm');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(
    dialog.getByText('Use a https://huggingface.co/… link to a .litertlm file.'),
  ).toBeVisible();
  await dialog
    .getByLabel('Hugging Face link')
    .fill('https://huggingface.co/a/b/resolve/main/m.bin');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  // Not a .litertlm file: the same link rule applies.
  await expect(
    dialog.getByText('Use a https://huggingface.co/… link to a .litertlm file.'),
  ).toBeVisible();

  // The upload tab refuses another file type.
  await dialog.getByRole('tab', { name: 'Upload file' }).click();
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });
  await expect(dialog.getByText('Only .litertlm files are supported.').first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  const models = await api<unknown[]>(admin, 'GET', orgApi('/models'));
  expect(models.body, 'nothing was created').toEqual([]);
});

test('models: upload a file, serve it from a pool, stop serving, delete', async ({ page }) => {
  await page.goto(orgUrl('/models'));
  await page.getByRole('button', { name: 'Add model' }).first().click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('tab', { name: 'Upload file' }).click();
  await dialog.locator('input[type=file]').setInputFiles({
    name: `${MODEL}.litertlm`,
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(4096, 7),
  });
  // The name follows the file name until the person types one.
  await expect(dialog.getByLabel('Name')).toHaveValue(MODEL);
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByText('Model uploaded.').first()).toBeVisible();
  await dialogsClosed(page);
  await expect(page.getByText(MODEL, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await expect(page.getByText(/Uploaded/)).toBeVisible();

  // The same name again is refused by the server.
  const dup = await api(admin, 'POST', orgApi('/models/uploads'), {
    name: MODEL,
    fileName: `${MODEL}.litertlm`,
    sizeBytes: 4096,
  });
  expect(dup.status).toBe(409);

  // A pool serves it: pick, set, then stop serving.
  await page.goto(orgUrl(`/pools/${poolId}`));
  await expect(page.getByText('This pool serves no model yet.')).toBeVisible();
  await page.getByRole('combobox').filter({ hasText: 'Pick the model to serve' }).click();
  await page.getByRole('option', { name: new RegExp(MODEL) }).click();
  await page.getByRole('button', { name: 'Set model' }).click();
  await expect(page.getByText('The pool now serves this model.').first()).toBeVisible();
  await expect(page.getByText('This pool serves no model yet.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop serving' }).click();
  await expect(page.getByText('This pool serves no model yet.')).toBeVisible();

  // Delete asks first.
  await page.goto(orgUrl('/models'));
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText(`Delete ${MODEL}?`)).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await dialogsClosed(page);
  await expect(page.getByText(MODEL, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Model deleted.').first()).toBeVisible();
  await expect(page.getByText('No models yet.')).toBeVisible();
});

test('API keys: create, use, edit limits and expiry, revoke', async ({ page }) => {
  await page.goto(orgUrl('/api-keys'));
  await expect(page.getByText('No API keys yet.')).toBeVisible();

  // The form refuses a key for "selected pools" without a pool.
  await page.getByRole('button', { name: 'New API key' }).first().click();
  const form = page.getByRole('dialog');
  const name = `ui-key-${uniq()}`;
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(form.getByText('This field is required.')).toBeVisible();
  await form.getByLabel('Name').fill(name);
  await form.getByRole('radio', { name: 'Selected pools' }).check();
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(form.getByText('Pick at least one pool.')).toBeVisible();
  expect((await api<unknown[]>(admin, 'GET', orgApi('/api-keys'))).body).toEqual([]);

  await form.getByRole('checkbox', { name: poolName }).check();
  await form.getByLabel('Requests per minute').fill('5');
  await form.getByRole('combobox', { name: 'Expires' }).click();
  await page.getByRole('option', { name: 'In 30 days' }).click();
  await form.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('API key created.').first()).toBeVisible();

  // The secret is shown once, with a ready-to-use example.
  const secret = await page.getByRole('textbox', { name: 'Copy your API key' }).inputValue();
  expect(secret.length).toBeGreaterThan(16);
  await expect(page.getByText('This is the only time the key is shown.')).toBeVisible();
  await expect(page.locator('pre')).toContainText('Authorization: Bearer');
  await page.getByRole('button', { name: 'Done' }).click();
  await dialogsClosed(page);
  await expect(page.getByText(secret)).toHaveCount(0);

  // The card describes the key; the key works against the gateway.
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  // Up to three pools are named on the card (the key prefix comes first).
  await expect(page.getByText(new RegExp(`… · ${poolName}$`))).toBeVisible();
  await expect(page.getByText('5 requests/min')).toBeVisible();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await gateway(page, secret, 'GET', '/models')).status, { timeout: 30_000 })
    .toBe(200);

  // Limits.
  await page.getByRole('button', { name: 'Edit limits' }).click();
  await expect(page.getByRole('dialog').getByText(`Limits for ${name}`)).toBeVisible();
  await page.getByRole('dialog').getByLabel('Requests per minute').fill('abc');
  await page.getByRole('dialog').getByRole('button', { name: 'Save limits' }).click();
  await expect(
    page
      .getByRole('dialog')
      .getByText(/Enter a whole number from 1 to/)
      .first(),
  ).toBeVisible();
  await page.getByRole('dialog').getByLabel('Requests per minute').fill('');
  await page.getByRole('dialog').getByLabel('Tokens per day').fill('1000');
  await page.getByRole('dialog').getByRole('button', { name: 'Save limits' }).click();
  await expect(page.getByText('Limits saved.').first()).toBeVisible();
  await dialogsClosed(page);
  await expect(page.getByText(/1000 tokens\/day/)).toBeVisible();
  await expect(page.getByText('5 requests/min')).toHaveCount(0);

  // Expiry: back to never.
  await page.getByRole('button', { name: 'Change expiry' }).click();
  await page.getByRole('dialog').getByRole('combobox', { name: 'Expires' }).click();
  await page.getByRole('option', { name: 'Never' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save expiry' }).click();
  await expect(page.getByText('Expiry updated.').first()).toBeVisible();
  await dialogsClosed(page);
  const keys = await api<{ expiresAt: string | null; limits: { tokensPerDay: number | null } }[]>(
    admin,
    'GET',
    orgApi('/api-keys'),
  );
  expect(keys.body[0]!.expiresAt).toBeNull();
  expect(keys.body[0]!.limits.tokensPerDay).toBe(1000);

  // Revoke asks first, then the gateway stops accepting the key.
  await page.getByRole('button', { name: 'Revoke' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText(`Revoke ${name}?`)).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await dialogsClosed(page);
  expect((await gateway(page, secret, 'GET', '/models')).status).toBe(200);
  await page.getByRole('button', { name: 'Revoke' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('API key revoked.').first()).toBeVisible();
  await expect(page.getByText('Revoked', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await gateway(page, secret, 'GET', '/models')).status, { timeout: 30_000 })
    .toBe(401);
});

test('audit log: the steps above, filtered, exported', async ({ page }) => {
  await page.goto(orgUrl('/audit'));
  await expect(page.getByText('API key created').first()).toBeVisible();
  await expect(page.getByText('Pool created').first()).toBeVisible();
  await expect(page.getByText('Model upload completed').first()).toBeVisible();
  await expect(page.getByText('Model deleted').first()).toBeVisible();

  // Filter by category: only API key rows stay.
  await page.getByRole('combobox', { name: 'Category' }).click();
  await page.getByRole('option', { name: 'API keys', exact: true }).click();
  await expect(page.getByText('API key created').first()).toBeVisible();
  await expect(page.getByText('Pool created')).toHaveCount(0);
  await expect(page.getByText('Model deleted')).toHaveCount(0);

  // Nothing matches a combination that never happened.
  await page.getByRole('combobox', { name: 'Outcome' }).click();
  await page.getByRole('option', { name: 'Failed', exact: true }).click();
  await expect(page.getByText('Nothing recorded for these filters.')).toBeVisible();

  // Export downloads a file.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^audit-log-.*\.csv$/);
});

test('usage and metrics: empty states and ranges work', async ({ page }) => {
  await page.goto(orgUrl('/usage'));
  await expect(page.getByText('No usage in this period.')).toBeVisible();
  await page.getByRole('combobox').filter({ hasText: 'Last 7 days' }).click();
  await page.getByRole('option', { name: 'Last 24 hours' }).click();
  await page.getByRole('combobox').filter({ hasText: 'None' }).click();
  await page.getByRole('option', { name: 'Pool', exact: true }).click();
  await expect(page.getByText('No usage in this period.')).toBeVisible();
  await expect(page.getByText('Could not load data')).toHaveCount(0);

  await page.goto(orgUrl('/metrics'));
  await expect(page.getByText('No data in this period.').first()).toBeVisible();
  await page.getByRole('combobox').filter({ hasText: 'Last hour' }).click();
  await page.getByRole('option', { name: 'Last 24 hours' }).click();
  await expect(page.getByText('Could not load data')).toHaveCount(0);
});

test('settings: rename, organisation limits, delete', async ({ page }) => {
  await page.goto(orgUrl('/settings'));
  const renamed = `${org.name} renamed`;
  await page.getByLabel('Name').first().fill(renamed);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved.').first()).toBeVisible();
  expect((await api<{ name: string }>(admin, 'GET', orgApi())).body.name).toBe(renamed);

  // A slug that is not allowed stays on the form.
  await page.getByLabel('Slug').fill('Not Allowed');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByText('Use lowercase letters, digits and single dashes.').first(),
  ).toBeVisible();
  await page.getByLabel('Slug').fill(org.slug);

  await page.getByLabel('Requests per minute').fill('100');
  await page.getByRole('button', { name: 'Save limits' }).click();
  await expect(page.getByText('Limits saved.').first()).toBeVisible();
  await dialogsClosed(page);
  const limits = await api<{ limits: { requestsPerMinute: number | null } }>(
    admin,
    'GET',
    orgApi(),
  );
  expect(limits.body.limits.requestsPerMinute).toBe(100);

  // Delete asks first; Cancel keeps the organisation.
  await page.getByRole('button', { name: 'Delete organisation' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText(`Delete ${renamed}?`)).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await dialogsClosed(page);
  expect((await api(admin, 'GET', orgApi())).status).toBe(200);
  await page.getByRole('button', { name: 'Delete organisation' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Organisation deleted.').first()).toBeVisible();
  await page.waitForURL(`${baseUrl()}/organisations`);
  expect((await api(admin, 'GET', orgApi())).status).toBe(404);
});
