import { expect, type Page } from '@playwright/test';
import { credentials } from '../../src/env.ts';

/** Opens a protected page of the web app and signs in through Dex's password form (the app redirects there by itself). */
export async function signIn(page: Page): Promise<void> {
  const { user, password } = credentials();
  await page.goto('/organisations');
  // With more than one connector (staging also has Google) Dex first lists them.
  const email = page.getByRole('link', { name: /email|local/i });
  await page.locator('#login').or(email).first().waitFor();
  if (await email.isVisible()) await email.click();
  await page.locator('#login').fill(user);
  await page.locator('#password').fill(password);
  await page.locator('#submit-login').click();
  // The nav is visible even when signed out; the session is only real once the app has exchanged the code and stored
  // the user (a reload before that aborts the exchange and sends the page back to Dex).
  await page.waitForFunction(() =>
    Object.keys(localStorage).some((k) => k.startsWith('oidc.user:')),
  );
  await expect(page).toHaveURL(/\/organisations/);
  await expect(page.getByRole('button', { name: 'New organisation' })).toBeVisible();
}
