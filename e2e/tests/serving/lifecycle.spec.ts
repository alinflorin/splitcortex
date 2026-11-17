import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { waitFor } from '../../src/api.ts';
import { bin, chat, startServingNode, type ServingNode } from '../../src/serving-node.ts';

// A live node over time: what it reports, a benchmark, a restart, an org-wide limit, revocation. Own node.
test.skip(!existsSync(bin) && !process.env.CI, `no CLI binary at ${bin} (set E2E_CLI_BIN)`);
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
const nodes = () => node.ws.nodes();

test('the node reports its status, device and engine settings', async () => {
  const online = await waitFor(
    'the node to report live',
    async () => (await nodes()).find((n) => n.status === 'online' && n.live?.backend),
    60_000,
  );
  expect(online.platform).toBe('cli');
  expect(online.approved).toBe(true);
  expect(['cpu', 'gpu']).toContain(online.live!.backend);
  expect(online.live!.maxContextTokens).toBeGreaterThan(0);
});

test('a benchmark measures every online node of the pool', async () => {
  const { ws } = node;
  const started = await ws.cp.startBenchmark(ws.org.id, ws.pool.id);
  expect(started.results).toHaveLength(1);
  const done = await waitFor(
    'the benchmark to finish',
    async () => {
      const b = (await ws.cp.benchmarks(ws.org.id, ws.pool.id)).find((x) => x.id === started.id);
      return b?.status === 'done' ? b : undefined;
    },
    120_000,
    3_000,
  );
  const r = done.results[0]!;
  expect(r.status, r.error ?? '').toBe('done');
  expect(r.tokens).toBeGreaterThan(0);
  expect(r.ttftMs).toBeGreaterThan(0);
  expect(r.tokensPerSec).toBeGreaterThan(0);
});

test('a stopped node goes offline and requests fail; a restarted one serves again', async () => {
  await node.halt();
  await waitFor(
    'the node to go offline',
    async () => (await nodes()).find((n) => n.status === 'offline'),
    60_000,
  );
  await waitFor(
    'requests to be refused with no node',
    async () => ((await chat(node.secret, one)).status === 503 ? true : undefined),
    30_000,
    1_000,
  );
  node.restart();
  await node.ready();
  expect((await nodes())[0]!.status).toBe('online');
});

test('an organisation-wide limit applies to every key and can be lifted', async () => {
  const { ws } = node;
  await ws.cp.setOrgLimits(ws.org.id, { requestsPerMinute: 2 });
  try {
    // Limits reach the gateway through its config feed; keep asking until one is refused.
    await waitFor(
      'the organisation limit to refuse a request',
      async () => ((await chat(node.secret, one)).status === 429 ? true : undefined),
      60_000,
      500,
    );
  } finally {
    await ws.cp.setOrgLimits(ws.org.id, { requestsPerMinute: null });
  }
  // The counter window is a minute; after it, and the lifted limit, requests pass again.
  await waitFor(
    'requests to pass after the limit is lifted',
    async () => ((await chat(node.secret, one)).status === 200 ? true : undefined),
    90_000,
    3_000,
  );
});

test('revoking the node disconnects it and it stops serving', async () => {
  const { ws } = node;
  const [n] = await nodes();
  await ws.cp.revokeNode(ws.org.id, n!.id);
  expect(await nodes()).toHaveLength(0);
  await waitFor(
    'requests to fail after the revoke',
    async () => ((await chat(node.secret, one)).status !== 200 ? true : undefined),
    60_000,
    1_000,
  );
});
