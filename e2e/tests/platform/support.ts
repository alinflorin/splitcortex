import { expect, type Page } from '@playwright/test';
import { credentials } from '../../src/env.ts';

/** Opens the web app and signs in through Dex's password form (the app redirects there by itself). */
export async function signIn(page: Page): Promise<void> {
  const { user, password } = credentials();
  await page.goto('/');
  // With more than one connector (staging also has Google) Dex first lists them.
  const email = page.getByRole('link', { name: /email|local/i });
  await page.locator('#login').or(email).first().waitFor();
  if (await email.isVisible()) await email.click();
  await page.locator('#login').fill(user);
  await page.locator('#password').fill(password);
  await page.locator('#submit-login').click();
  await expect(page.getByRole('link', { name: 'Organisations' }).first()).toBeVisible();
}
