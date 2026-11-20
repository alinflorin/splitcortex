import { expect, test } from '@playwright/test';
import { cp } from '../lib/api';
import { authFile, baseUrl, users } from '../lib/env';
import { loadState } from '../lib/state';

// Tenant isolation: a second E2E user must not see or touch the first user's organisation.
test('another user cannot reach the organisation', async ({ browser }) => {
  test.skip(users().length < 2, 'needs a second E2E user');
  const { orgId, chatPoolId } = loadState();
  const context = await browser.newContext({ storageState: authFile(1) });
  const page = await context.newPage();
  await page.goto(baseUrl());
  for (const path of [
    `/organisations/${orgId}`,
    `/organisations/${orgId}/pools/${chatPoolId}/nodes`,
    `/organisations/${orgId}/api-keys`,
  ]) {
    const res = await cp(page, 'GET', path);
    expect([403, 404], path).toContain(res.status());
  }
  expect((await cp(page, 'DELETE', `/organisations/${orgId}`)).ok()).toBe(false);
  const list = (await (await cp(page, 'GET', '/organisations')).json()) as { id: string }[];
  expect(list.map((o) => o.id)).not.toContain(orgId);
  await context.close();
});
