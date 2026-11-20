import { expect, test } from '@playwright/test';
import { waitFor } from '../../src/api.ts';
import { fakeEmbedding, SIM_EMBEDDING_DIMENSION } from '../../src/perf/fake-node.ts';
import { PERF_EMBED_MODEL, startFleet, type Fleet } from '../../src/perf/fleet.ts';
import { regressions, summarize, writeResult } from '../../src/perf/stats.ts';
import { embed } from '../../src/serving-node.ts';

// POST /v1/embeddings under load, with simulated nodes whose "model" returns deterministic vectors
// (fakeEmbedding in src/perf/fake-node.ts), so the numbers are the gateway's overhead (routing, batching of inputs,
// metering), not a model's speed. Knobs: PERF_NODES (default 20), PERF_STEPS (concurrent clients per step, default
// 1,5,20), PERF_REQUESTS (per client per step, default 3), PERF_EMBED_INPUTS (inputs per request, default 8).
const NODES = Number(process.env.PERF_NODES || 20);
const STEPS = (process.env.PERF_STEPS || '1,5,20').split(',').map(Number);
const REQUESTS = Number(process.env.PERF_REQUESTS ?? 3);
const INPUTS = Number(process.env.PERF_EMBED_INPUTS ?? 8);

test.skip(!process.env.E2E_PERF, 'set E2E_PERF=1 (pnpm test:perf) to run the load tests');
test.describe.configure({ mode: 'serial', timeout: 900_000 });

let fleet: Fleet;
test.beforeAll(async () => {
  fleet = await startFleet(NODES, undefined, 'embedding');
});
test.afterAll(async () => {
  await fleet?.stop();
});

interface Timed {
  status: number;
  ms: number;
  vectors: number[][];
}
const inputsFor = (client: number, n: number) =>
  Array.from({ length: INPUTS }, (_, i) => `client ${client} request ${n} text ${i}`);

async function timedEmbed(client: number, n: number): Promise<Timed & { inputs: string[] }> {
  const inputs = inputsFor(client, n);
  const t0 = performance.now();
  const res = await embed(fleet.secret, { model: PERF_EMBED_MODEL, input: inputs });
  const body = (await res.json().catch(() => null)) as {
    data?: { index: number; embedding: number[] }[];
  } | null;
  return {
    status: res.status,
    ms: performance.now() - t0,
    vectors: (body?.data ?? []).sort((a, b) => a.index - b.index).map((d) => d.embedding),
    inputs,
  };
}

test('latency and requests per second as concurrency rises', async () => {
  const report: Record<string, unknown> = {};
  const metrics: Record<string, number> = {};
  for (const clients of STEPS) {
    const t0 = performance.now();
    const results = (
      await Promise.all(
        Array.from({ length: clients }, async (_, c) => {
          const out = [];
          for (let n = 0; n < REQUESTS; n++) out.push(await timedEmbed(c, n));
          return out;
        }),
      )
    ).flat();
    const seconds = (performance.now() - t0) / 1000;
    const ok = results.filter((r) => r.status === 200);
    const latency = summarize(ok.map((r) => r.ms));
    report[`c${clients}`] = {
      clients,
      requests: results.length,
      errors: results.length - ok.length,
      requestsPerSec: Math.round((ok.length / seconds) * 10) / 10,
      latencyMs: latency,
    };
    metrics[`c${clients}.latency.p95`] = latency.p95;
    console.log(
      `embeddings c=${clients}: ${ok.length}/${results.length} ok, ${(ok.length / seconds).toFixed(1)} req/s, latency p50/p95 ${latency.p50}/${latency.p95} ms`,
    );
    if (clients <= NODES) expect(ok.length, `errors at ${clients} clients`).toBe(results.length);
    // One vector per input, in the order of the inputs, with the length the node reports.
    for (const r of ok) {
      expect(r.vectors).toHaveLength(INPUTS);
      r.vectors.forEach((v, i) => {
        expect(v).toHaveLength(SIM_EMBEDDING_DIMENSION);
        // The simulated model is deterministic: this is the vector of THIS input (float32 on the wire).
        const expected = fakeEmbedding(r.inputs[i]!, '');
        expect(v[0]).toBeCloseTo(expected[0]!, 5);
        expect(v[SIM_EMBEDDING_DIMENSION - 1]).toBeCloseTo(
          expected[SIM_EMBEDDING_DIMENSION - 1]!,
          5,
        );
      });
    }
  }
  writeResult('embeddings-latency', { nodes: NODES, inputs: INPUTS, steps: report, metrics });
  expect(regressions('embeddings-latency', metrics)).toEqual([]);
});

test('dimensions and task reach the node and change what comes back', async () => {
  const res = await embed(fleet.secret, {
    model: PERF_EMBED_MODEL,
    input: ['same text', 'same text'],
    dimensions: 16,
    task: 'query',
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { embedding: number[] }[] };
  expect(body.data).toHaveLength(2);
  expect(body.data[0]!.embedding).toHaveLength(16);
  expect(body.data[0]!.embedding[0]).toBeCloseTo(fakeEmbedding('same text', 'query', 16)[0]!, 5);
  expect(body.data[0]!.embedding[0]).not.toBeCloseTo(fakeEmbedding('same text', '', 16)[0]!, 3);
});

test('the usage the gateway records equals what the nodes embedded', async () => {
  const { requests, embeddedTokens } = fleet.totals();
  expect(requests).toBeGreaterThan(0);
  const totals = await waitFor(
    'the usage totals to match',
    async () => {
      const t = (await fleet.ws.cp.usageByKey(fleet.ws.org.id)).totals;
      return t.requests === requests && t.tokensIn === embeddedTokens ? t : undefined;
    },
    90_000,
    2_000,
  ).catch(async () => (await fleet.ws.cp.usageByKey(fleet.ws.org.id)).totals);
  expect({ requests: totals.requests, tokensIn: totals.tokensIn }).toEqual({
    requests,
    tokensIn: embeddedTokens,
  });
});
