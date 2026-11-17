import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { waitFor } from '../../src/api.ts';
import { bin, chat, startServingNode, type ServingNode } from './node.ts';

// What guards the product: API key scope and revocation, rate limits, tenant isolation, and metering. Runs against its
// own real node (same setup as inference.spec.ts); requests ask for one token to keep the engine out of the way.
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

test('a revoked key stops working', async () => {
  const { ws } = node;
  const key = await ws.apiKey();
  expect((await chat(key.secret, one)).status).toBe(200);
  await ws.cp.revokeApiKey(ws.org.id, key.id);
  // The gateway learns of it through its config feed, within seconds.
  await waitFor(
    'the revoked key to be refused',
    async () => ((await chat(key.secret, one)).status === 401 ? true : undefined),
    30_000,
    1_000,
  );
});

test('a key scoped to another pool cannot reach this pool’s model', async () => {
  const { ws } = node;
  const other = await ws.cp.createPool(ws.org.id, 'e2e-other-pool');
  const scoped = await ws.apiKey({ poolIds: [other.id] });
  expect((await chat(scoped.secret, one)).status).toBe(404);
  const own = await ws.apiKey({ poolIds: [ws.pool.id] });
  expect((await chat(own.secret, one)).status).toBe(200);
});

test('a key over its request limit gets 429 in the OpenAI error shape', async () => {
  const limited = await node.ws.apiKey({ limits: { requestsPerMinute: 2 } });
  // 5 quick requests cannot all fit in two one-minute windows with a limit of 2 each.
  const statuses: number[] = [];
  let refused: Response | undefined;
  for (let i = 0; i < 5; i++) {
    const res = await chat(limited.secret, one);
    statuses.push(res.status);
    if (res.status === 429) refused ??= res;
  }
  expect(statuses[0]).toBe(200);
  expect(statuses).toContain(429);
  const body = (await refused!.json()) as { error: { message: string; type: string } };
  expect(body.error.message).toBeTruthy();
  expect(body.error.type).toBeTruthy();
});

test('another organisation cannot see or use this one', async () => {
  const { ws, modelId } = node;
  const other = await ws.cp.createOrg();
  try {
    const foreign = await ws.cp.createApiKey(other.id);
    // Its key finds no pool serving the model.
    expect((await chat(foreign.secret, one)).status).toBe(404);
    // Our ids under its organisation id resolve to nothing.
    expect(await ws.cp.probe(`/organisations/${other.id}/models/${modelId}`)).toBe(404);
    expect(await ws.cp.probe(`/organisations/${other.id}/pools/${ws.pool.id}`)).toBe(404);
    expect(await ws.cp.probe(`/organisations/${other.id}/pools/${ws.pool.id}/nodes`)).toBe(404);
  } finally {
    await ws.cp.deleteOrg(other.id);
  }
});

test('usage is metered per key', async () => {
  const { ws } = node;
  const key = await ws.apiKey();
  for (let i = 0; i < 3; i++) expect((await chat(key.secret, one)).status).toBe(200);
  // Counters are flushed to the database in batches, so poll.
  const point = await waitFor(
    'the usage of the key to be recorded',
    async () => {
      const usage = await ws.cp.usageByKey(ws.org.id);
      return usage.series.find((p) => p.group === key.id && p.requests >= 3);
    },
    90_000,
    3_000,
  );
  expect(point.tokensOut).toBeGreaterThan(0);
  expect(point.tokensIn).toBeGreaterThan(0);
});
