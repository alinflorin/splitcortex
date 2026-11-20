import { expect, test } from '@playwright/test';
import { waitFor } from '../../src/api.ts';
import { PERF_MODEL, startFleet, type Fleet } from '../../src/perf/fleet.ts';
import { chat } from '../../src/serving-node.ts';

// Remote restart of a whole fleet: an admin restarts every node through the control plane (queue + NOTIFY + the
// gateway instance that holds each node), the simulated nodes close and reconnect (SimNode handles `Restart`), and
// the pool serves again. Knob: PERF_RESTART_NODES (default 10).
const NODES = Number(process.env.PERF_RESTART_NODES || 10);

test.skip(!process.env.E2E_PERF, 'set E2E_PERF=1 (pnpm test:perf) to run the load tests');
test.describe.configure({ mode: 'serial', timeout: 900_000 });

let fleet: Fleet;
test.beforeAll(async () => {
  fleet = await startFleet(NODES);
});
test.afterAll(async () => {
  await fleet?.stop();
});

test('every node restarts on request and the pool serves again', async () => {
  const { ws } = fleet;
  const nodes = await ws.nodes();
  expect(nodes).toHaveLength(NODES);
  const before = new Map(nodes.map((n) => [n.id, n.live?.connectedSince ?? null]));

  const started = performance.now();
  for (const n of nodes) {
    const res = await ws.cp.restartNode(ws.org.id, n.id);
    expect(res.status, `restart of ${n.id}`).toBe(202);
  }
  await waitFor(
    'every simulated node to have received Restart',
    async () => (fleet.nodes.every((n) => n.restarts >= 1) ? true : undefined),
    120_000,
    1_000,
  );
  // Each came back as a new connection.
  await waitFor(
    'every node to reconnect',
    async () => {
      const now = await ws.nodes();
      return now.length === NODES &&
        now.every(
          (n) =>
            n.status === 'online' &&
            n.live?.connectedSince &&
            n.live.connectedSince !== before.get(n.id),
        )
        ? true
        : undefined;
    },
    180_000,
    2_000,
  );
  console.log(
    `restart of ${NODES} nodes: back online after ${Math.round(performance.now() - started)} ms`,
  );

  await waitFor(
    'the pool to serve after the restart',
    async () => {
      const r = await chat(fleet.secret, { model: PERF_MODEL, max_tokens: 1 });
      await r.arrayBuffer();
      return r.status === 200 ? true : undefined;
    },
    60_000,
    1_000,
  );
});
