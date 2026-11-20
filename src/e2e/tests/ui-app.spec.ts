import { expect, test, type Page } from '@playwright/test';
import { api, uniq, userPage } from '../lib/api';
import { dialogsClosed } from '../lib/ui';
import { authFile, baseUrl, dexUrl, users } from '../lib/env';

// The web app outside an organisation: the signed-out visitor, Home, About, the sidebar, the account menu (theme,
// language, sign out), account settings, creating an organisation through the form, the phone-sized layout, the
// copy buttons. Everything an organisation contains is in `ui.spec.ts`, `ui-admin.spec.ts` and `ui-org.spec.ts`.
test.describe.configure({ mode: 'serial' });

const me = () => users()[0]!;
const created: string[] = [];
let admin: Page;

test.beforeAll(async ({ browser }) => {
  admin = await userPage(browser, 0);
});

test.afterAll(async () => {
  for (const id of created) await api(admin, 'DELETE', `/organisations/${id}`);
  await admin.context().close();
});

test.describe('signed out', () => {
  test('Home invites to sign in; About and the not-found page need no account', async ({
    page,
  }) => {
    await page.goto(baseUrl());
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Your devices.');
    await expect(page.getByRole('button', { name: 'Get started' }).first()).toBeVisible();
    await expect(page.getByText('Welcome back')).toHaveCount(0);
    // The sidebar is the top-level menu; the org pages are not listed.
    for (const link of ['Home', 'Organisations', 'Playground', 'About']) {
      await expect(page.getByRole('link', { name: link, exact: true }), link).toBeVisible();
    }
    await page.getByRole('link', { name: 'About', exact: true }).click();
    await page.waitForURL(`${baseUrl()}/about`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('About SplitCortex');
    await expect(page.getByText('How a request travels')).toBeVisible();
  });

  test('a private page sends to the sign-in, and "Get started" does too', async ({ page }) => {
    for (const path of ['/organisations', '/playground', '/user-settings']) {
      await page.goto(`${baseUrl()}${path}`);
      await page.waitForURL(`${dexUrl()}/**`);
    }
    await page.goto(baseUrl());
    await page.getByRole('button', { name: 'Get started' }).first().click();
    await page.waitForURL(`${dexUrl()}/**`);
    await expect(page.locator('#login')).toBeVisible();
  });

  test('a wrong password stays on the sign-in page', async ({ page }) => {
    await page.goto(`${baseUrl()}/organisations`);
    await page.waitForURL(`${dexUrl()}/**`);
    const viaEmail = page.getByRole('link', { name: /log in with email/i });
    if (await viaEmail.isVisible().catch(() => false)) await viaEmail.click();
    await page.locator('#login').fill(me().email);
    await page.locator('#password').fill(`wrong-${uniq()}`);
    await page.locator('#submit-login').click();
    await expect(page.locator('#login')).toBeVisible();
    expect(page.url().startsWith(dexUrl())).toBe(true);
  });
});

test.describe('signed in', () => {
  test.use({ storageState: authFile(0) });

  test('Home: welcome, the way into the organisations, the sections', async ({ page }) => {
    await page.goto(baseUrl());
    await expect(page.getByText('Welcome back')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Get started' })).toHaveCount(0);
    for (const chip of ['OpenAI-compatible API', 'Outbound-only connections', 'Per-device keys']) {
      await expect(page.getByText(chip, { exact: true }).first(), chip).toBeVisible();
    }
    // The three steps and the feature list.
    for (const step of ['Enroll your devices', 'Pick a model and a pool', 'Call the API']) {
      await expect(page.getByText(step).first(), step).toBeVisible();
    }
    // "How it works" is an anchor on the same page.
    await page.getByRole('link', { name: 'How it works' }).first().click();
    await expect(page).toHaveURL(/#how$/);
    // The Playground teaser and the way to the organisations.
    // (it opens in a new tab)
    const popup = page.waitForEvent('popup');
    await page.getByRole('link', { name: 'Open the Playground' }).first().click();
    const tab = await popup;
    await tab.waitForURL(`${baseUrl()}/playground`);
    await expect(tab.getByRole('heading', { level: 1, name: 'Playground' })).toBeVisible();
    await tab.close();
    await page.goto(baseUrl());
    await page.getByRole('button', { name: 'Open my organisations' }).click();
    await page.waitForURL(`${baseUrl()}/organisations`);
  });

  test('Home: node downloads and the endpoints to copy', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(baseUrl());
    // Run a node: the rolling releases, the install one-liners, the web node.
    await expect(page.getByText('Run a node').first()).toBeVisible();
    const apk = page.getByRole('link', { name: 'Download APK' });
    await expect(apk).toHaveAttribute('href', /github\.com\/.+\/releases\/.*mobile-node-latest/);
    await expect(page.getByRole('link', { name: 'All command line downloads' })).toHaveAttribute(
      'href',
      /releases\/.*cli-node-latest/,
    );
    await expect(page.getByText(/install\.sh/).first()).toBeVisible();
    await expect(page.getByText(/install\.ps1/).first()).toBeVisible();
    await page.getByRole('button', { name: /^Copy: Linux and macOS/ }).click();
    await expect(page.getByText('Command copied').first()).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('install.sh');
    const web = page.getByRole('link', { name: 'Open web node' });
    await expect(web).toHaveAttribute('href', /^https:\/\/web-node\./);
    await page.getByRole('button', { name: 'Share link' }).click();
    await expect(
      page.getByText(/Web node link copied|Could not share the link/).first(),
    ).toBeVisible();

    // Endpoints: the gateway (OpenAI) and the control plane, each with a copy button.
    await expect(page.getByText('Gateway (OpenAI API)').first()).toBeVisible();
    await page.getByRole('button', { name: 'Copy: Gateway (OpenAI API)' }).click();
    await expect(page.getByText('Address copied').first()).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^https:\/\/.+\/v1$/);
    await page.getByRole('button', { name: 'Copy: Control plane API' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
      /^https:\/\/.+\/api$/,
    );
  });

  test('About: the story, the flow and the call to action', async ({ page }) => {
    await page.goto(`${baseUrl()}/about`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('About SplitCortex');
    for (const text of [
      'Billions of capable devices sit idle',
      'How a request travels',
      'The problem',
      'Our answer',
    ]) {
      await expect(page.getByText(text).first(), text).toBeVisible();
    }
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  });

  test('sidebar: the top-level menu, the active item, back out of an organisation', async ({
    page,
  }) => {
    await page.goto(baseUrl());
    const orgs = page.getByRole('link', { name: 'Organisations', exact: true });
    await orgs.click();
    await page.waitForURL(`${baseUrl()}/organisations`);
    await expect(orgs).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'Playground', exact: true }).click();
    await page.waitForURL(`${baseUrl()}/playground`);
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await page.waitForURL(`${baseUrl()}/`);
    await expect(page.getByText(/^Version /)).toBeVisible();
    // The brand link in the top bar goes home from anywhere.
    await page.goto(`${baseUrl()}/about`);
    await page.getByRole('link', { name: 'SplitCortex', exact: true }).first().click();
    await page.waitForURL(`${baseUrl()}/`);
    // The sidebar can be hidden and shown again.
    const nav = page.getByRole('link', { name: 'About', exact: true });
    await expect(nav).toBeVisible();
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await expect(nav).toBeHidden();
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await expect(nav).toBeVisible();
  });

  test('account menu: who you are, theme, language (kept after a reload)', async ({ page }) => {
    await page.goto(baseUrl());
    await page.getByRole('button', { name: 'Account' }).click();
    await expect(page.getByRole('menu').getByText(me().email, { exact: true })).toBeVisible();

    // Theme: dark is remembered, "System" forgets it again.
    await page.getByRole('menuitem', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    expect(await page.evaluate(() => localStorage.getItem('sc-theme'))).toBe('dark');
    const background = () =>
      page.evaluate(
        () => getComputedStyle(document.querySelector('.fui-FluentProvider')!).backgroundColor,
      );
    const dark = await background();
    await page.reload();
    expect(await page.evaluate(() => localStorage.getItem('sc-theme'))).toBe('dark');
    expect(await background()).toBe(dark);
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('menuitem', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name: 'Light' }).click();
    expect(await page.evaluate(() => localStorage.getItem('sc-theme'))).toBe('light');
    expect(await background()).not.toBe(dark);
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('menuitem', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name: 'System' }).click();
    expect(await page.evaluate(() => localStorage.getItem('sc-theme'))).toBeNull();

    // Language: the page, the menu and the saved choice change together.
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('menuitem', { name: 'Language' }).click();
    await page.getByRole('menuitemradio', { name: 'Română' }).click();
    await expect(page.getByRole('link', { name: 'Organizații', exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('sc-lang'))).toBe('ro');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('ro');
    await page.reload();
    await expect(page.getByRole('link', { name: 'Organizații', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cont' }).click();
    await page.getByRole('menuitem', { name: 'Limbă' }).click();
    await page.getByRole('menuitemradio', { name: 'English' }).click();
    await expect(page.getByRole('link', { name: 'Organisations', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
  });

  test('account settings: the account, and "Delete account" asks first', async ({ page }) => {
    await page.goto(baseUrl());
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('menuitem', { name: 'Account settings' }).click();
    await page.waitForURL(`${baseUrl()}/user-settings`);
    await expect(page.getByRole('heading', { level: 1, name: 'Account settings' })).toBeVisible();
    await expect(page.getByText(me().email.toLowerCase(), { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Danger zone')).toBeVisible();

    await page.getByRole('button', { name: 'Delete account' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByText('Delete your account?')).toBeVisible();
    await expect(
      confirm.getByText(/cannot delete your account while you are the only owner/),
    ).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await dialogsClosed(page);
    // Nothing happened: still signed in and still the same page.
    await expect(page).toHaveURL(`${baseUrl()}/user-settings`);
    expect((await api(page, 'GET', '/me')).status).toBe(200);
  });

  test('organisations: create through the form (slug follows the name, errors stay on the form)', async ({
    page,
  }) => {
    await page.goto(`${baseUrl()}/organisations`);
    await page.getByRole('button', { name: 'New organisation' }).click();
    const dialog = page.getByRole('dialog');

    // Empty: both fields are required.
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog.getByText('This field is required.').first()).toBeVisible();

    // The slug is suggested from the name until it is edited by hand.
    const tag = uniq();
    await dialog.getByLabel('Name').fill(`UI Org ${tag}`);
    await expect(dialog.getByLabel('Slug')).toHaveValue(`ui-org-${tag}`);
    await dialog.getByLabel('Slug').fill('Not Allowed');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(
      dialog.getByText('Use lowercase letters, digits and single dashes.'),
    ).toBeVisible();
    await dialog.getByLabel('Name').fill(`UI Org ${tag} b`);
    await expect(dialog.getByLabel('Slug')).toHaveValue('Not Allowed');
    await dialog.getByLabel('Slug').fill(`ui-org-${tag}`);

    // Cancel forgets the form.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialogsClosed(page);
    await page.getByRole('button', { name: 'New organisation' }).click();
    await expect(page.getByRole('dialog').getByLabel('Name')).toHaveValue('');

    await page.getByRole('dialog').getByLabel('Name').fill(`UI Org ${tag}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Organisation created.').first()).toBeVisible();
    await page.waitForURL(/\/organisations\/[0-9a-f-]+\/models$/);
    const id = page.url().split('/')[4]!;
    created.push(id);
    await expect(page.getByText('Owner', { exact: true }).first()).toBeVisible();
    expect((await api<{ slug: string }>(admin, 'GET', `/organisations/${id}`)).body.slug).toBe(
      `ui-org-${tag}`,
    );

    // The same slug again is refused by the server and the form stays open.
    await page.goto(`${baseUrl()}/organisations`);
    await expect(page.getByText(`ui-org-${tag}`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'New organisation' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill(`Other ${tag}`);
    await page.getByRole('dialog').getByLabel('Slug').fill(`ui-org-${tag}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/already/i).first()).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await dialogsClosed(page);
  });

  test('on a phone the sidebar is a drawer that closes after a choice', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: authFile(0),
      viewport: { width: 390, height: 800 },
    });
    const page = await context.newPage();
    try {
      await page.goto(`${baseUrl()}/organisations`);
      await expect(page.getByRole('heading', { level: 1, name: 'Organisations' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'About', exact: true })).toBeHidden();
      await page.getByRole('button', { name: 'Toggle navigation' }).click();
      await page.getByRole('link', { name: 'About', exact: true }).click();
      await page.waitForURL(`${baseUrl()}/about`);
      await expect(page.getByRole('link', { name: 'About', exact: true })).toBeHidden();
      // No sideways scrolling on a phone.
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true);
    } finally {
      await context.close();
    }
  });

  test('sign out ends the session; the private pages ask again', async ({ page }) => {
    await page.goto(`${baseUrl()}/organisations`);
    await expect(page.getByRole('heading', { level: 1, name: 'Organisations' })).toBeVisible();
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.waitForURL(`${baseUrl()}/`);
    await expect(page.getByRole('button', { name: 'Get started' }).first()).toBeVisible();
    expect(
      await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('oidc.user:'))),
    ).toBe(false);
    await page.getByRole('button', { name: 'Account' }).click();
    await expect(page.getByRole('menuitem', { name: 'Sign in' })).toBeVisible();
  });
});
