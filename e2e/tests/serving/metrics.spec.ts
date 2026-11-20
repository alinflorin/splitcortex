import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { waitFor } from '../../src/api.ts';
import { bin, chat, startServingNode, type ServingNode } from '../../src/serving-node.ts';
import { signIn } from '../platform/support.ts';

// Per-organisation metrics (issue #23): the gateway writes pool and node numbers per minute into Postgres and the
// control plane serves them. Needs a live node, and a wait for the gateway's minute batch to land.
test.skip(!existsSync(bin) && !process.env.CI, `no CLI binary at ${bin} (set E2E_CLI_BIN)`);
test.describe.configure({ mode: 'serial', timeout: 300_000 });

interface Metrics {
  step: string;
  pools: {
    requests: number;
    tokensOut: number;
    peakInFlight: number;
    latencyP50Ms: number | null;
  }[];
  nodes: {
    nodesReporting: number;
    tokensPerSec: number | null;
    memoryUsedMb: number | null;
    requests: number;
    failures: number;
    measuredTokensPerSec: number | null;
  }[];
}

let node: ServingNode;
test.beforeAll(async () => {
  node = await startServingNode();
  await node.ready();
});
test.afterAll(async () => {
  await node?.stop();
});

const metrics = async (query = ''): Promise<Metrics> => {
  const res = await node.ws.cp.send('GET', `/organisations/${node.ws.org.id}/metrics${query}`);
  expect(res.status).toBe(200);
  return res.body as Metrics;
};
const sum = (m: Metrics, f: (p: Metrics['pools'][number]) => number) =>
  m.pools.reduce((n, p) => n + f(p), 0);

test('traffic shows up as pool metrics with latency', async () => {
  // Long enough for the speed sample the gateway keeps (at least 8 tokens and 250 ms of generation), which the
  // per-node test below depends on.
  for (let i = 0; i < 3; i++) {
    const r = await chat(node.secret, {
      max_tokens: 64,
      messages: [{ role: 'user', content: 'Count from 1 to 60, separated by commas.' }],
    });
    expect(r.status).toBe(200);
  }
  const m = await waitFor(
    'the gateway to write the pool metrics',
    async () => {
      const x = await metrics();
      // Requests come from usage_records, latency and in-flight from pool_metrics: the gateway flushes them separately.
      const ready =
        sum(x, (p) => p.requests) >= 3 &&
        sum(x, (p) => p.peakInFlight) > 0 &&
        x.pools.some((p) => p.latencyP50Ms !== null && p.latencyP50Ms > 0);
      return ready ? x : undefined;
    },
    180_000,
    5_000,
  );
  expect(sum(m, (p) => p.tokensOut)).toBeGreaterThan(0);
  expect(m.pools.some((p) => p.latencyP50Ms !== null && p.latencyP50Ms > 0)).toBe(true);
  expect(sum(m, (p) => p.peakInFlight)).toBeGreaterThan(0);
});

test('the same numbers can be narrowed to the pool, and another pool is empty', async () => {
  const { ws } = node;
  const own = await metrics(`?poolId=${ws.pool.id}`);
  expect(sum(own, (p) => p.requests)).toBeGreaterThanOrEqual(3);
  const other = await ws.cp.createPool(ws.org.id, 'e2e-metrics-other');
  expect(sum(await metrics(`?poolId=${other.id}`), (p) => p.requests)).toBe(0);
});

test('the node reports device telemetry per minute', async () => {
  const m = await waitFor(
    'the node metrics',
    async () => {
      const x = await metrics();
      return x.nodes.some((n) => n.nodesReporting > 0) ? x : undefined;
    },
    180_000,
    5_000,
  );
  expect(m.nodes.some((n) => n.memoryUsedMb !== null)).toBe(true);
  const [n] = await node.ws.nodes();
  const one = await metrics(`?nodeId=${n!.id}`);
  expect(one.nodes.some((p) => p.nodesReporting === 1)).toBe(true);
});

test('the gateway measures what each node served: requests, failures and tokens per second', async () => {
  // Not what the device reports about itself (tokensPerSec) but what the gateway saw from finished requests; the
  // gateway also routes on this number, which is not observable with one node.
  const [n] = await node.ws.nodes();
  const m = await waitFor(
    'the measured numbers of the node',
    async () => {
      const x = await metrics(`?nodeId=${n!.id}`);
      const served = x.nodes.reduce((s, p) => s + p.requests, 0);
      return served >= 3 && x.nodes.some((p) => p.measuredTokensPerSec !== null) ? x : undefined;
    },
    180_000,
    5_000,
  );
  expect(m.nodes.reduce((s, p) => s + p.failures, 0)).toBe(0);
  const speeds = m.nodes.map((p) => p.measuredTokensPerSec).filter((v): v is number => v !== null);
  expect(speeds.length).toBeGreaterThan(0);
  expect(speeds.every((v) => v > 0)).toBe(true);
});

test('the range is capped and another organisation sees none of it', async () => {
  const { ws } = node;
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const wide = await ws.cp.send('GET', `/organisations/${ws.org.id}/metrics?from=${from}`);
  expect(wide.status).toBe(400);
  const other = await ws.cp.createOrg();
  try {
    const res = await ws.cp.send('GET', `/organisations/${other.id}/metrics`);
    expect(res.status).toBe(200);
    const m = res.body as Metrics;
    expect(sum(m, (p) => p.requests)).toBe(0);
    expect(m.nodes.every((n) => n.nodesReporting === 0)).toBe(true);
  } finally {
    await ws.cp.deleteOrg(other.id);
  }
});

test('the web app charts the traffic of the pool and the node', async ({ page }) => {
  const { ws } = node;
  await signIn(page);
  await page.goto(`/organisations/${ws.org.id}/metrics`);
  await expect(page.getByText('Requests', { exact: true }).first()).toBeVisible();
  // Some charts are empty by design (refusals are all zero, a CI runner has no battery or temperature), so only
  // the charts the test's traffic feeds must have data.
  for (const title of ['Requests', 'Tokens', 'Request duration']) {
    await expect(
      page.getByRole('img', { name: title, exact: true }).getByText('No data in this period.'),
    ).toHaveCount(0);
  }
  const [n] = await ws.nodes();
  await page.goto(`/organisations/${ws.org.id}/pools/${ws.pool.id}`);
  await expect(page.getByText('Metrics').first()).toBeVisible();
  await page.goto(`/organisations/${ws.org.id}/nodes/${n!.id}`);
  await expect(page.getByText('CPU', { exact: true }).first()).toBeVisible();
});
