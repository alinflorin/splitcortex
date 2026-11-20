import { test } from '@playwright/test';
import { cp, poolNodes } from '../lib/api';
import { authFile, baseUrl } from '../lib/env';
import { loadState } from '../lib/state';

// Runs after every other project, also when they failed: removes what this run added (devices, API key). The
// organisation, its models and pools stay, so the models are not downloaded from Hugging Face again.
test("remove this run's devices and API key", async ({ browser }) => {
  let s;
  try {
    s = loadState();
  } catch {
    return; // setup never got that far
  }
  const context = await browser.newContext({ storageState: authFile(0) });
  const page = await context.newPage();
  await page.goto(baseUrl());
  for (const poolId of [s.chatPoolId, s.embedPoolId]) {
    for (const n of await poolNodes(page, s.orgId, poolId)) {
      await cp(page, 'DELETE', `/organisations/${s.orgId}/nodes/${n.id}`);
    }
  }
  await cp(page, 'DELETE', `/organisations/${s.orgId}/api-keys/${s.apiKeyId}`);
  await context.close();
});
