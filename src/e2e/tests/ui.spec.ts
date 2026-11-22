import { expect, test, type Page } from '@playwright/test';
import { api, createOrg, deleteOrg, uniq, userPage } from '../lib/api';
import { dialogsClosed } from '../lib/ui';
import { authFile, baseUrl, users } from '../lib/env';

// The web app as a person uses it, in a throw-away organisation (created and deleted here, through the API, so these
// tests do not depend on the models or devices of the run): every page of the organisation, the pool lifecycle
// (create, edit, add-device code, delete), members, what a plain member does not get, Romanian, the Playground with a
// wrong key, the not-found page. (Models, API keys and the device round trip are covered by `setup` and `nodes`.)
test.describe.configure({ mode: 'serial' });
test.use({ storageState: authFile(0) });

let admin: Page;
let org: { id: string; slug: string; name: string };
const me = () => users()[0]!.email.toLowerCase();
const orgUrl = (path = '') => `${baseUrl()}/organisations/${org.id}${path}`;

test.beforeAll(async ({ browser }) => {
  admin = await userPage(browser, 0);
  org = await createOrg(admin, 'ui');
});

test.afterAll(async () => {
  await deleteOrg(admin, org.id);
  await admin.context().close();
});

test('organisations: the list, the card, the sidebar and the breadcrumb', async ({ page }) => {
  await page.goto(`${baseUrl()}/organisations`);
  await expect(page.getByRole('heading', { level: 1, name: 'Organisations' })).toBeVisible();
  await page.getByText(org.name, { exact: true }).first().click();
  await page.waitForURL(new RegExp(`/organisations/${org.id}`));
  // The sidebar names the organisation and the caller's role; the breadcrumb links back to the list.
  await expect(page.getByText('Owner', { exact: true }).first()).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Organisations' }),
  ).toBeVisible();
});

test('every page of the organisation loads without an error', async ({ page }) => {
  await page.goto(orgUrl('/pools'));
  const pages: [string, string][] = [
    ['Pools', '/pools'],
    ['Models', '/models'],
    ['API keys', '/api-keys'],
    ['Members', '/members'],
    ['Usage', '/usage'],
    ['Metrics', '/metrics'],
    ['Audit log', '/audit'],
    ['Settings', '/settings'],
  ];
  for (const [link, path] of pages) {
    await page.getByRole('link', { name: link, exact: true }).click();
    await page.waitForURL(orgUrl(path));
    await expect(page.getByRole('heading', { level: 1 }).first(), link).toBeVisible();
    await expect(page.getByText('Could not load data'), `${link}: load error`).toHaveCount(0);
    await expect(page.getByText('Something went wrong'), `${link}: error`).toHaveCount(0);
  }
  await page.goto(`${baseUrl()}/playground`);
  await expect(page.getByRole('heading', { level: 1, name: 'Playground' })).toBeVisible();
});

test('pool: create, edit, add-device code, delete', async ({ page }) => {
  await page.goto(orgUrl('/pools'));
  await expect(page.getByText('No pools yet.')).toBeVisible();

  const name = `ui-pool-${uniq()}`;
  await page.getByRole('button', { name: 'New pool' }).first().click();
  await page.getByRole('dialog').getByLabel('Name').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Pool created.').first()).toBeVisible();
  await page.getByText(name, { exact: true }).click();
  await page.waitForURL(/\/pools\/[0-9a-f-]+$/);
  const poolId = page.url().split('/').pop()!;
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByText('No devices in this pool yet.')).toBeVisible();
  await expect(page.getByText('Automatic').first()).toBeVisible();

  // Edit: rename and require approval.
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const renamed = `${name}-b`;
  await page.getByRole('dialog').getByLabel('Name').fill(renamed);
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Require admin approval' }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Pool updated.').first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible();
  await expect(page.getByText('Approval required').first()).toBeVisible();

  // Add device: a code in the right format; closing the dialog cancels it.
  await page.getByRole('button', { name: 'Add device' }).first().click();
  await expect(page.getByTestId('enroll-code')).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{6}$/);
  await expect(page.getByText(/Valid for \d+:\d\d/)).toBeVisible();
  const active = await api<unknown[]>(
    admin,
    'GET',
    `/organisations/${org.id}/pools/${poolId}/enrollments`,
  );
  expect(active.body).toHaveLength(1);
  // A new code replaces it: the old one is cancelled, so there is still exactly one active.
  const first = await page.getByTestId('enroll-code').innerText();
  await page.getByRole('dialog').getByRole('button', { name: 'New code' }).click();
  await expect(page.getByTestId('enroll-code')).not.toHaveText(first);
  await expect
    .poll(
      async () =>
        (await api<unknown[]>(admin, 'GET', `/organisations/${org.id}/pools/${poolId}/enrollments`))
          .body.length,
    )
    .toBe(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByTestId('enroll-code')).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await api<unknown[]>(admin, 'GET', `/organisations/${org.id}/pools/${poolId}/enrollments`))
          .body.length,
    )
    .toBe(0);

  // Delete asks first; Cancel keeps the pool.
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText(`Delete pool ${renamed}?`)).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect((await api(admin, 'GET', `/organisations/${org.id}/pools/${poolId}`)).status).toBe(200);
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Pool deleted.').first()).toBeVisible();
  await page.waitForURL(orgUrl('/pools'));
  await expect(page.getByText('No pools yet.')).toBeVisible();
  expect((await api(admin, 'GET', `/organisations/${org.id}/pools/${poolId}`)).status).toBe(404);
});

test('members: you, add, remove', async ({ page }) => {
  await page.goto(orgUrl('/members'));
  await expect(page.getByText(me()).first()).toBeVisible();
  await expect(page.getByText('you', { exact: true })).toBeVisible();

  const email = `ui-${uniq()}@example.com`;
  await page.getByRole('button', { name: 'Add member' }).first().click();
  await page.getByRole('dialog').getByLabel('Email').fill(email);
  await page.getByRole('dialog').getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByText('Member added.').first()).toBeVisible();
  await dialogsClosed(page);
  await expect(page.getByText(email)).toBeVisible();

  // A wrong address is refused on the form, nothing is sent.
  await page.getByRole('button', { name: 'Add member' }).first().click();
  await page.getByRole('dialog').getByLabel('Email').fill('not-an-email');
  await page.getByRole('dialog').getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await dialogsClosed(page);
  const members = await api<{ email: string }[]>(admin, 'GET', `/organisations/${org.id}/members`);
  expect(members.body.map((m) => m.email)).toEqual([me(), email]);

  // Remove the guest (asks first).
  await page.getByRole('button', { name: 'Remove' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText(`Remove ${email}?`)).toBeVisible();
  await confirm.getByRole('button').last().click();
  await expect(page.getByText('Member removed.').first()).toBeVisible();
  await expect(page.getByText(email)).toHaveCount(0);
});

test('a plain member sees less, and a stranger sees nothing', async ({ browser }) => {
  test.skip(users().length < 2, 'needs a second E2E user');
  const two = users()[1]!.email.toLowerCase();
  expect(
    (await api(admin, 'POST', `/organisations/${org.id}/members`, { email: two, role: 'member' }))
      .status,
  ).toBe(201);
  const context = await browser.newContext({ storageState: authFile(1) });
  const page = await context.newPage();
  try {
    await page.goto(orgUrl('/pools'));
    await expect(page.getByRole('link', { name: 'Pools', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Members', exact: true })).toBeVisible();
    // Keys, the audit log and the settings are for admins.
    for (const hidden of ['API keys', 'Audit log', 'Settings']) {
      await expect(page.getByRole('link', { name: hidden, exact: true }), hidden).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: 'New pool' })).toHaveCount(0);
    await expect(page.getByText('Member', { exact: true }).first()).toBeVisible();

    // Removed: the organisation is gone for them.
    expect(
      (await api(admin, 'DELETE', `/organisations/${org.id}/members/${encodeURIComponent(two)}`))
        .status,
    ).toBe(204);
    await page.goto(orgUrl('/pools'));
    await expect(page.getByText('Organisation not found.')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('Romanian: pages and API errors follow the language', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sc-lang', 'ro'));
  await page.goto(`${baseUrl()}/organisations`);
  await expect(page.getByRole('heading', { level: 1, name: 'Organizații' })).toBeVisible();
  await page.goto(orgUrl('/pools'));
  await expect(page.getByText('Încă nu există pool-uri.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Membri', exact: true })).toBeVisible();

  // The server's error comes back in Romanian too (the app sends Accept-Language).
  const name = `ro-${uniq()}`;
  expect((await api(admin, 'POST', `/organisations/${org.id}/pools`, { name })).status).toBe(201);
  await page.getByRole('button', { name: 'Pool nou' }).first().click();
  await page.getByRole('dialog').getByLabel('Nume').fill(name);
  await page.getByRole('dialog').getByRole('button', { name: 'Creează' }).click();
  await expect(page.getByText('Există deja un pool cu acest nume').first()).toBeVisible();
});

test('Playground: a wrong key is refused with the gateway message', async ({ page }) => {
  await page.goto(`${baseUrl()}/playground`);
  await page.getByLabel('API key').fill('sk-this-is-not-a-key');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText('Incorrect API key provided.')).toBeVisible();
});

test('an unknown address shows the not-found page', async ({ page }) => {
  await page.goto(`${baseUrl()}/definitely-not-a-page`);
  await expect(page.getByText('Page not found')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to home' })).toBeVisible();
  await page.goto(`${baseUrl()}/organisations/${crypto.randomUUID()}/pools`);
  await expect(page.getByText('Organisation not found.')).toBeVisible();
});
