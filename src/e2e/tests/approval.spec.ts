import { expect, test, type Page } from '@playwright/test';
import { api, cp, createOrg, deleteOrg, poolNodes, uniq, userPage } from '../lib/api';
import { webNode } from '../lib/drivers/web';
import { authFile, baseUrl } from '../lib/env';

// A pool that requires approval: the device enrolls but waits; an admin approves it on the page, then it is online.
// A browser tab is the device (no model is assigned, so nothing is downloaded), in a throw-away organisation.
test.use({ storageState: authFile(0) });

let admin: Page;
let org: { id: string; name: string };

test.beforeAll(async ({ browser }) => {
  admin = await userPage(browser, 0);
  org = await createOrg(admin, 'appr');
});

test.afterAll(async () => {
  await webNode.stop();
  await deleteOrg(admin, org.id);
  await admin.context().close();
});

test('a device in an approval pool waits, is approved on its page, then comes online', async ({
  page,
  browser,
}) => {
  test.setTimeout(10 * 60_000);
  const poolName = `approval-${uniq()}`;
  const pool = await api<{ id: string }>(admin, 'POST', `/organisations/${org.id}/pools`, {
    name: poolName,
    requireApproval: true,
  });
  expect(pool.status).toBe(201);
  const url = `${baseUrl()}/organisations/${org.id}`;

  // The dialog says the device will wait.
  await page.goto(`${url}/pools/${pool.body.id}`);
  await page.getByRole('button', { name: 'Add device' }).first().click();
  await expect(page.getByText('This pool requires approval', { exact: false })).toBeVisible();
  const code = await page.getByTestId('enroll-code').innerText();
  await webNode.join(code, { browser }).catch(() => undefined); // it may not "Stop" before approval: judged below

  let nodeId = '';
  await expect
    .poll(
      async () => {
        const nodes = await poolNodes(admin, org.id, pool.body.id);
        nodeId = nodes[0]?.id ?? '';
        return nodes[0]?.status;
      },
      { timeout: 2 * 60_000, intervals: [3_000] },
    )
    .toBe('pending');

  await page.goto(`${url}/pools/${pool.body.id}`);
  await expect(page.getByText('Pending approval').first()).toBeVisible();
  await page.goto(`${url}/nodes/${nodeId}`);
  await expect(page.getByText('Waiting for approval')).toBeVisible();
  await expect(page.getByText('Approve this device to let it serve requests.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restart', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Node approved.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  await expect
    .poll(async () => (await poolNodes(admin, org.id, pool.body.id))[0]?.status, {
      timeout: 3 * 60_000,
      intervals: [3_000],
      message: 'the approved device never came online',
    })
    .toBe('online');

  // Approved is audited.
  const log = await cp(admin, 'GET', `/organisations/${org.id}/audit-logs?action=node.&limit=50`);
  const actions = ((await log.json()) as { items: { action: string }[] }).items.map(
    (i) => i.action,
  );
  expect(actions).toEqual(expect.arrayContaining(['node.enroll', 'node.update']));
});
