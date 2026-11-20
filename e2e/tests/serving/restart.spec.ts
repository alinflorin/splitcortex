import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { waitFor } from '../../src/api.ts';
import { bin, chat, startServingNode, type ServingNode } from '../../src/serving-node.ts';
import { signIn } from '../platform/support.ts';

// Remote restart of a live node: the control plane queues the command, the gateway instance that holds the node sends
// it, the CLI node finishes what it serves, re-executes itself in place and reconnects. Same process id, so the test
// sees it as a new connection (`live.connectedSince` moves) and then as a node that serves again. Needs a node build
// that knows the command (the newest cli-node release, or E2E_CLI_BIN); set E2E_SKIP_RESTART=1 for an older one.
test.skip(!existsSync(bin) && !process.env.CI, `no CLI binary at ${bin} (set E2E_CLI_BIN)`);
test.skip(
  process.env.E2E_SKIP_RESTART === '1',
  'E2E_SKIP_RESTART=1: this node build has no remote restart',
);
test.describe.configure({ mode: 'serial', timeout: 300_000 });

let node: ServingNode;
test.beforeAll(async () => {
  node = await startServingNode();
  await node.ready();
});
test.afterAll(async () => {
  await node?.stop();
});

const one = { max_tokens: 1 };
const theNode = async () => {
  const [n] = await node.ws.nodes();
  expect(n).toBeTruthy();
  return n!;
};
const since = async () => (await theNode()).live?.connectedSince ?? null;

/** Waits for a new connection of the node (its `connectedSince` differs from `before`) and for serving again. */
async function reconnected(before: string | null): Promise<void> {
  await waitFor(
    'the node to reconnect after the restart',
    async () => {
      const n = await theNode();
      const at = n.live?.connectedSince ?? null;
      return n.status === 'online' && at !== null && at !== before ? at : undefined;
    },
    180_000,
    2_000,
  ).catch((e: Error) => {
    throw new Error(`${e.message}\nnode log:\n${node.log()}`);
  });
  await node.ready();
}

test('restarting through the API makes the node reconnect and serve again', async () => {
  const { ws } = node;
  const n = await theNode();
  const before = await since();
  expect(before).not.toBeNull();

  const res = await ws.cp.restartNode(ws.org.id, n.id);
  expect(res.status).toBe(202);
  expect((res.body as { id: string }).id).toBeTruthy();

  await reconnected(before);
  const answer = await chat(node.secret, one);
  expect(answer.status).toBe(200);
  await answer.arrayBuffer();
});

test('the restart is in the audit log with the node as entity', async () => {
  const { ws } = node;
  const n = await theNode();
  const row = await waitFor(
    'the audit row node.restart',
    async () => {
      const r = await ws.cp.send(
        'GET',
        `/organisations/${ws.org.id}/audit-logs?action=node.restart&limit=20`,
      );
      const items = (
        r.body as {
          items: { entityType: string; entityId: string; outcome: string; source: string }[];
        }
      ).items;
      return items.find((e) => e.entityId === n.id);
    },
    30_000,
    1_000,
  );
  expect(row).toMatchObject({ entityType: 'node', outcome: 'success', source: 'control_plane' });
});

test('the node page restarts the device after a confirmation', async ({ page }) => {
  const { ws } = node;
  const n = await theNode();
  const before = await since();
  await signIn(page);
  await page.goto(`/organisations/${ws.org.id}/nodes/${n.id}`);
  const button = page.getByRole('button', { name: 'Restart', exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  // The confirm dialog names the device; its button is the last "Restart" in the DOM.
  await expect(page.getByText(`Restart ${n.name}?`)).toBeVisible();
  await page.getByRole('button', { name: 'Restart', exact: true }).last().click();
  await expect(page.getByText('Restart sent.')).toBeVisible();

  await reconnected(before);
  // The page follows the live status: online again, button usable again.
  await expect(button).toBeEnabled({ timeout: 60_000 });
});

test('a stopped node cannot be restarted: 409, and the button is disabled', async ({ page }) => {
  const { ws } = node;
  const n = await theNode();
  await node.halt();
  await waitFor(
    'the node to go offline',
    async () => ((await theNode()).status === 'offline' ? true : undefined),
    90_000,
  );
  expect((await ws.cp.restartNode(ws.org.id, n.id)).status).toBe(409);

  await signIn(page);
  await page.goto(`/organisations/${ws.org.id}/nodes/${n.id}`);
  await expect(page.getByRole('button', { name: 'Restart', exact: true })).toBeDisabled();
});
