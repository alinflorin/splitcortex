import { expect, test } from '@playwright/test';
import { webNodeUrl } from '../lib/env';

// The web node's join screen, without a device: the form validates the code's shape, and a code the server does not
// know is refused with one generic message (nothing says whether a code ever existed). The full join and serve path
// is in `nodes.spec.ts`.
test('join: shape check, then a generic refusal of an unknown code', async ({ page }) => {
  await page.goto(webNodeUrl());
  await expect(page.getByRole('heading', { level: 1, name: 'Web node' })).toBeVisible();
  await expect(page.getByText('Join a pool')).toBeVisible();

  const code = page.getByLabel('Join code');
  const join = page.getByRole('button', { name: 'Join', exact: true });

  await code.fill('abc');
  await join.click();
  await expect(page.getByText('Enter the code as XXXX-XXXXXX.')).toBeVisible();

  await code.fill('ZZZZ-ZZZZZZ');
  await join.click();
  await expect(
    page.getByText(/This code is not valid, has expired or was already used/),
  ).toBeVisible();
  // Still on the join screen: nothing was enrolled.
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0);
});

test('join: the Romanian page', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sc-lang', 'ro'));
  await page.goto(webNodeUrl());
  await expect(page.getByText('Alătură-te unui pool')).toBeVisible();
});
