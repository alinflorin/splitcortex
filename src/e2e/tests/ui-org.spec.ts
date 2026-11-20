import { expect, test, type Page } from '@playwright/test';
import { api, createOrg, deleteOrg, uniq, userPage } from '../lib/api';
import { dialogsClosed } from '../lib/ui';
import { authFile, baseUrl, users } from '../lib/env';
import { loadState } from '../lib/state';

// The rest of an organisation's screens, as a person clicks through them (a throw-away organisation, created and
// deleted here): the organisation sidebar, pool cards and the pool page's sections, the balancing choice, the bulk
// enrollment dialog, benchmarks, member roles, usage and metrics controls, the Playground with a real key, and the
// "not found" answers inside an organisation. Models, keys, settings and the audit log are in `ui-admin.spec.ts`.
test.use({ storageState: authFile(0) });

let admin: Page;
let org: { id: string; slug: string; name: string };
const orgUrl = (path = '') => `${baseUrl()}/organisations/${org.id}${path}`;
const orgApi = (path = '') => `/organisations/${org.id}${path}`;

test.beforeAll(async ({ browser }) => {
  admin = await userPage(browser, 0);
  org = await createOrg(admin, 'org');
});

test.afterAll(async () => {
  await deleteOrg(admin, org.id);
  await admin.context().close();
});

test('organisation sidebar: the name and role, every page marked active, back to the list', async ({
  page,
}) => {
  await page.goto(orgUrl());
  await page.waitForURL(orgUrl('/models'));
  const side = page.getByLabel('Organisation', { exact: true });
  await expect(side.getByText(org.name)).toBeVisible();
  await expect(side.getByText('Owner')).toBeVisible();
  const pages: [string, string][] = [
    ['Models', '/models'],
    ['Pools', '/pools'],
    ['API keys', '/api-keys'],
    ['Members', '/members'],
    ['Usage', '/usage'],
    ['Metrics', '/metrics'],
    ['Audit log', '/audit'],
    ['Settings', '/settings'],
  ];
  for (const [name, path] of pages) {
    await page.goto(orgUrl(path));
    await expect(page.getByRole('link', { name, exact: true }), name).toHaveAttribute(
      'aria-current',
      'page',
    );
  }
  await page.getByRole('link', { name: 'All organisations' }).click();
  await page.waitForURL(`${baseUrl()}/organisations`);
  await expect(page.getByRole('link', { name: 'Organisations', exact: true })).toBeVisible();
});

test('pools: the card (state, approval), the balancing choice, the icons on the card', async ({
  page,
}) => {
  await page.goto(orgUrl('/pools'));
  const name = `card-${uniq()}`;
  await page.getByRole('button', { name: 'New pool' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.getByText('This field is required.')).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  // Every balancing type is offered, with its explanation.
  await dialog.getByRole('combobox', { name: 'Load balancing' }).click();
  for (const option of ['Weighted power of two choices', 'Least busy', 'Round robin', 'Random']) {
    await expect(page.getByRole('option', { name: option }), option).toBeVisible();
  }
  await page.getByRole('option', { name: 'Round robin' }).click();
  await expect(dialog.getByText('Nodes in turn, regardless of load or speed.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Pool created.').first()).toBeVisible();
  await dialogsClosed(page);

  const card = page.getByText(name, { exact: true });
  await expect(card).toBeVisible();
  await expect(page.getByText('0 / 0 nodes online')).toBeVisible();
  await expect(page.getByRole('img', { name: 'No node online' })).toBeVisible();
  await expect(page.getByText('Automatic').first()).toBeVisible();
  const pools = await api<{ id: string; name: string; balancingType: string }[]>(
    admin,
    'GET',
    orgApi('/pools'),
  );
  expect(pools.body.find((p) => p.name === name)?.balancingType).toBe('round_robin');

  // Edit from the card icon keeps the chosen balancing; the page is not opened.
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await expect(page.getByRole('dialog').getByLabel('Name')).toHaveValue(name);
  await expect(
    page.getByRole('dialog').getByRole('combobox', { name: 'Load balancing' }),
  ).toHaveText('Round robin');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await dialogsClosed(page);
  await expect(page).toHaveURL(orgUrl('/pools'));

  // Delete from the card icon (asks first).
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Pool deleted.').first()).toBeVisible();
  await expect(page.getByText('No pools yet.')).toBeVisible();
});

test('pool page: details, sections, back link, add many devices', async ({ page }) => {
  const name = `page-${uniq()}`;
  const pool = await api<{ id: string }>(admin, 'POST', orgApi('/pools'), { name });
  expect(pool.status).toBe(201);
  const poolId = pool.body.id;
  const codes = async () =>
    (await api<unknown[]>(admin, 'GET', orgApi(`/pools/${poolId}/enrollments`))).body.length;

  await page.goto(orgUrl(`/pools/${poolId}`));
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  // The details card and the five sections.
  await expect(page.getByText('Details', { exact: true })).toBeVisible();
  for (const section of ['Devices', 'Model', 'Benchmarks', 'Usage', 'Metrics']) {
    await expect(page.getByText(section, { exact: true }).first(), section).toBeVisible();
  }
  await expect(page.getByText('This pool serves no model yet.')).toBeVisible();
  await expect(page.getByText('No devices in this pool yet.')).toBeVisible();
  await expect(page.getByText('No benchmarks yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Need the app/ })).toBeVisible();
  await expect(page.getByText('Could not load data')).toHaveCount(0);

  // Add many devices: the count is checked, one code per device, closing cancels the unused ones.
  await page.getByRole('button', { name: 'Add many devices' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Up to')).toBeVisible();
  // A wrong count is explained and the button stays off, so nothing is sent.
  for (const bad of ['0', '-1', '1.5', '100000']) {
    await dialog.getByLabel('Number of devices').fill(bad);
    await expect(dialog.getByText(/Enter a whole number from 1 to/), bad).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Create codes' }), bad).toBeDisabled();
  }
  expect(await codes()).toBe(0);
  await dialog.getByLabel('Number of devices').fill('3');
  await dialog.getByRole('button', { name: 'Create codes' }).click();
  await expect(dialog.getByText(/Valid for \d+:\d\d/)).toBeVisible();
  await expect(dialog.getByText('0 of 3 devices enrolled')).toBeVisible();
  await expect(dialog.getByText(/^[0-9A-Z]{4}-[0-9A-Z]{6}$/)).toHaveCount(3);
  expect(await codes()).toBe(3);
  await expect(dialog.getByText(/API address if a device asks for it/)).toBeVisible();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await dialogsClosed(page);
  await expect.poll(codes).toBe(0);

  // The back link goes to the list.
  await page.getByRole('link', { name: /Pools/ }).first().click();
  await page.waitForURL(orgUrl('/pools'));
  await api(admin, 'DELETE', orgApi(`/pools/${poolId}`));
});

test('benchmarks: run on a pool without a device, nothing breaks', async ({ page }) => {
  const name = `bench-${uniq()}`;
  const pool = await api<{ id: string }>(admin, 'POST', orgApi('/pools'), { name });
  await page.goto(orgUrl(`/pools/${pool.body.id}`));
  await expect(page.getByText('No benchmarks yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Run benchmark' }).click();
  // Either the run starts (and ends with nothing to measure) or the server says why not; the page stays usable.
  await expect(
    page.getByText(/Benchmark started\.|Something went wrong|model|device/i).first(),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await api(admin, 'DELETE', orgApi(`/pools/${pool.body.id}`));
});

test('members: change a role from the list', async ({ page }) => {
  const email = `role-${uniq()}@example.com`;
  expect((await api(admin, 'POST', orgApi('/members'), { email, role: 'member' })).status).toBe(
    201,
  );
  await page.goto(orgUrl('/members'));
  const role = () =>
    api<{ email: string; role: string }[]>(admin, 'GET', orgApi('/members')).then(
      (r) => r.body.find((m) => m.email === email)?.role,
    );
  // The guest is the last row (the owner's row is first).
  const picker = page.getByRole('combobox', { name: 'Role' }).last();
  await expect(page.getByRole('combobox', { name: 'Role' })).toHaveCount(2);
  await picker.click();
  await page.getByRole('option', { name: 'Admin' }).click();
  await expect(page.getByText('Role updated.').first()).toBeVisible();
  await expect.poll(role).toBe('admin');
  await picker.click();
  await page.getByRole('option', { name: 'Member' }).click();
  await expect.poll(role).toBe('member');
  await api(admin, 'DELETE', orgApi(`/members/${encodeURIComponent(email)}`));
});

test('members: the second user as admin, then leaving', async ({ browser }) => {
  test.skip(users().length < 2, 'needs a second E2E user');
  const two = users()[1]!.email.toLowerCase();
  expect((await api(admin, 'POST', orgApi('/members'), { email: two, role: 'admin' })).status).toBe(
    201,
  );
  const context = await browser.newContext({ storageState: authFile(1) });
  const page = await context.newPage();
  try {
    await page.goto(orgUrl('/members'));
    // An admin sees the admin pages and the owner's row without a picker or a remove button.
    for (const link of ['API keys', 'Audit log', 'Settings']) {
      await expect(page.getByRole('link', { name: link, exact: true }), link).toBeVisible();
    }
    await expect(page.getByText('Admin', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Leave' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByText('Leave this organisation?')).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await dialogsClosed(page);
    await page.getByRole('button', { name: 'Leave' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Leave' }).click();
    await expect(page.getByText('You left the organisation.').first()).toBeVisible();
    await page.waitForURL(`${baseUrl()}/organisations`);
    const members = await api<{ email: string }[]>(admin, 'GET', orgApi('/members'));
    expect(members.body.map((m) => m.email)).not.toContain(two);
  } finally {
    await context.close();
  }
});

test('usage: every period and grouping can be chosen', async ({ page }) => {
  await page.goto(orgUrl('/usage'));
  for (const range of ['Last 24 hours', 'Last 30 days', 'Last 7 days']) {
    await page.getByRole('combobox', { name: 'Period' }).click();
    await page.getByRole('option', { name: range }).click();
    await expect(page.getByRole('combobox', { name: 'Period' })).toHaveText(range);
  }
  for (const group of ['Pool', 'Model', 'API key', 'None']) {
    await page.getByRole('combobox', { name: 'Group by' }).click();
    await page.getByRole('option', { name: group, exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Group by' })).toHaveText(group);
    await expect(page.getByText('Could not load data')).toHaveCount(0);
  }
});

test('metrics: every period, the live switch, the charts', async ({ page }) => {
  await page.goto(orgUrl('/metrics'));
  for (const range of [
    'Last 15 minutes',
    'Last 6 hours',
    'Last 24 hours',
    'Last 7 days',
    'Last hour',
  ]) {
    await page.getByRole('combobox', { name: 'Period' }).click();
    await page.getByRole('option', { name: range }).click();
    await expect(page.getByRole('combobox', { name: 'Period' })).toHaveText(range);
  }
  const live = page.getByRole('switch', { name: 'Live' });
  const wasLive = await live.isChecked();
  await live.click();
  await expect(live).toBeChecked({ checked: !wasLive });
  await live.click();
  await expect(live).toBeChecked({ checked: wasLive });
  await expect(page.getByText('Could not load data')).toHaveCount(0);
  await expect(page.getByText('No data in this period.').first()).toBeVisible();
});

test('Playground: connect with a real key, choose, attach, clear', async ({ page }) => {
  const state = loadState();
  await page.goto(`${baseUrl()}/playground`);
  await expect(page.getByRole('heading', { level: 1, name: 'Playground' })).toBeVisible();
  // Nothing to do before connecting.
  await expect(page.getByLabel('Message')).toHaveCount(0);
  await page.getByLabel('API key').fill('  ');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText('This field is required.')).toBeVisible();

  await page.getByLabel('API key').fill(state.apiKey);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('button', { name: 'Reconnect' })).toBeVisible();
  const model = page.getByLabel('Model');
  await expect(model).toBeVisible();
  expect(await model.locator('option').count()).toBeGreaterThan(0);

  // The settings are checked on the form.
  await page.getByLabel('Temperature').fill('9');
  await page.getByLabel('Message').fill('hello');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Enter a number from 0 to 2, or leave it empty.')).toBeVisible();
  await page.getByLabel('Temperature').fill('0.5');

  // Attachments: a text file is accepted and removable; an unsupported type is explained.
  const input = page.getByTestId('attachment-input');
  await input.setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('some notes'),
  });
  await expect(page.getByText('notes.txt')).toBeVisible();
  await page.getByRole('button', { name: 'Remove notes.txt' }).click();
  await expect(page.getByText('notes.txt')).toHaveCount(0);
  await input.setInputFiles({
    name: 'archive.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('PK'),
  });
  await expect(page.getByText(/“archive\.zip” can't be attached/)).toBeVisible();

  // No device is online during this project, so the gateway refuses; the page shows it and stays usable.
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('hello', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
  await expect(page.getByLabel('Message')).toBeEnabled();
  await page.getByRole('button', { name: 'Clear conversation' }).click();
  await expect(page.getByText('hello', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear conversation' })).toBeDisabled();
});

test('inside an organisation an unknown pool, device or address says so', async ({ page }) => {
  await page.goto(orgUrl(`/pools/${crypto.randomUUID()}`));
  await expect(page.getByText(/not found/i).first()).toBeVisible();
  await page.goto(orgUrl(`/nodes/${crypto.randomUUID()}`));
  await expect(page.getByText(/not found/i).first()).toBeVisible();
  await page.goto(orgUrl('/nothing-here'));
  await expect(page.getByText('Page not found')).toBeVisible();
});
