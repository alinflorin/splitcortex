import { expect, type Page } from '@playwright/test';
import { baseUrl, dexUrl } from './env';

/** Signs in through Dex (password database; stg also offers Google, so the chooser is handled). */
export async function login(page: Page, email: string, password: string) {
  await page.goto(`${baseUrl()}/organisations`);
  await page.waitForURL(`${dexUrl()}/**`);
  const viaEmail = page.getByRole('link', { name: /log in with email/i });
  if (await viaEmail.isVisible().catch(() => false)) await viaEmail.click();
  await page.locator('#login').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#submit-login').click();
  await page.waitForURL(`${baseUrl()}/**`);
  await expect(page.getByRole('heading', { name: 'Organisations' })).toBeVisible();
}

/** The access token the SPA holds (oidc-client-ts keeps the user in localStorage). */
export async function accessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (key.startsWith('oidc.user:')) {
        return (JSON.parse(localStorage.getItem(key)!) as { access_token: string }).access_token;
      }
    }
    return null;
  });
  if (!token) throw new Error('Not signed in: no OIDC user in localStorage');
  return token;
}
