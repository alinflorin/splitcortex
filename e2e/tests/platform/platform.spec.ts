import { expect, test } from '@playwright/test';
import { createWorkspace, type Workspace } from '../../src/api.ts';
import { signIn } from './support.ts';

// Setup goes through the API (fast, independent of the UI); the browser checks what an operator sees and does.
test.describe.configure({ mode: 'serial' });

let ws: Workspace;
test.beforeAll(async () => {
  ws = await createWorkspace();
});
test.afterAll(async () => {
  await ws?.cleanup();
});

test('signed-in user sees the organisation and its pool', async ({ page }) => {
  await signIn(page);
  await page.goto('/organisations');
  await expect(page.getByText(ws.org.name)).toBeVisible();
  await page.goto(`/organisations/${ws.org.id}/pools`);
  await expect(page.getByText(ws.pool.name)).toBeVisible();
});
