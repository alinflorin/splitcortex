import { expect, test, type Page } from '@playwright/test';
import { baseUrl, webNodeUrl } from '../lib/env';

// Google Analytics: production only, and only after the visitor accepts. Local and stg have no measurement id, so no
// banner and no request to Google; where an id is set (production) nothing is requested before "Accept". Requests to
// Google are blocked here so a test run never lands in the real analytics data.

const sites = [
  ['web app', () => baseUrl()],
  ['web node', () => webNodeUrl()],
] as const;

async function watch(page: Page) {
  const google: string[] = [];
  await page.route(/googletagmanager\.com|google-analytics\.com/, (route) => {
    google.push(route.request().url());
    return route.abort();
  });
  return google;
}

for (const [name, url] of sites) {
  test(`${name}: analytics follows the environment and waits for consent`, async ({
    page,
    request,
  }) => {
    const { analyticsId } = (await (await request.get(`${url()}/config.json`)).json()) as {
      analyticsId: string;
    };
    const google = await watch(page);
    await page.goto(url());
    const banner = page.getByRole('dialog', { name: 'Cookies and analytics' });
    if (!analyticsId) {
      // local, stg: nothing to ask, nothing sent, no "Cookie settings" entry
      await page.waitForTimeout(1500);
      await expect(banner).toHaveCount(0);
      expect(google).toEqual([]);
      return;
    }
    expect(analyticsId).toMatch(/^G-[A-Z0-9]+$/);
    await expect(banner).toBeVisible();
    await page.waitForTimeout(1500);
    expect(google, 'nothing before Accept').toEqual([]);
    await banner.getByRole('button', { name: 'Accept' }).click();
    await expect.poll(() => google.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => localStorage.getItem('sc-consent'))).toBe('granted');
    // chosen once: not asked again after a reload, until "Cookie settings"
    await page.reload();
    await page.waitForTimeout(1000);
    await expect(banner).toHaveCount(0);
  });
}
