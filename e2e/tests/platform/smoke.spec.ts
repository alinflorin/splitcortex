import { expect, test } from '@playwright/test';
import { apiUrl, appUrl, dexUrl } from '../../src/env.ts';

test.describe('deployment smoke', () => {
  test('web app is served and reports its version', async ({ request }) => {
    expect((await request.get(`${appUrl}/healthz`)).ok()).toBe(true);
    const v = (await (await request.get(`${appUrl}/version.json`)).json()) as { version: string };
    expect(v.version).toBeTruthy();
  });

  test('control plane is up and rejects calls without a token', async ({ request }) => {
    // /healthz of the control plane is not routed through the ingress; a 401 shows the API answers and enforces auth.
    expect((await request.get(`${apiUrl}/organisations`)).status()).toBe(401);
  });

  test('Dex publishes its discovery document', async ({ request }) => {
    const res = await request.get(`${dexUrl}/.well-known/openid-configuration`);
    expect(res.ok()).toBe(true);
    expect(((await res.json()) as { issuer: string }).issuer).toBe(dexUrl);
  });

  test('an anonymous visitor is sent to sign in at Dex', async ({ page }) => {
    // Home is public; the organisations pages are behind sign-in.
    await page.goto('/organisations');
    await page.waitForURL((u) => u.origin === dexUrl);
  });
});
