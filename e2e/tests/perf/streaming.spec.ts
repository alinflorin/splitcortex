import { expect, test } from '@playwright/test';
import { waitFor } from '../../src/api.ts';
import { startFleet, PERF_MODEL, type Fleet } from '../../src/perf/fleet.ts';
import { timedStream, type StreamResult } from '../../src/perf/sse-client.ts';
import { regressions, summarize, writeResult } from '../../src/perf/stats.ts';

// Gateway + control plane under load, with simulated nodes (src/perf/fake-node.ts): they speak the real protocol but
// "generate" on a timer, so the numbers are the platform's overhead, not a model's speed. Point this at a dedicated or
// local stack, not a shared one. Knobs (environment): PERF_NODES (default 20), PERF_STEPS (concurrent clients per
// step, default 1,5,20), PERF_REQUESTS (per client per step, default 3), PERF_TOKENS (pieces per answer, default 32),
// PERF_TOLERANCE (allowed slowdown against perf-baseline/, default 0.5).
const NODES = Number(process.env.PERF_NODES || 20);
const STEPS = (process.env.PERF_STEPS || '1,5,20').split(',').map(Number);
const REQUESTS = Number(process.env.PERF_REQUESTS ?? 3);
const TOKENS = Number(process.env.PERF_TOKENS ?? 32);

// Opt in (`pnpm test:perf`): a plain `pnpm test` must not start a load test.
test.skip(!process.env.E2E_PERF, 'set E2E_PERF=1 (pnpm test:perf) to run the load tests');
test.describe.configure({ mode: 'serial', timeout: 900_000 });

let fleet: Fleet;
test.beforeAll(async () => {
  fleet = await startFleet(NODES);
});
test.afterAll(async () => {
  await fleet?.stop();
});

/** `clients` concurrent callers, each sending `REQUESTS` streaming requests one after the other. */
async function step(clients: number): Promise<StreamResult[]> {
  const all = await Promise.all(
    Array.from({ length: clients }, async () => {
      const results: StreamResult[] = [];
      for (let i = 0; i < REQUESTS; i++)
        results.push(await timedStream(fleet.secret, PERF_MODEL, TOKENS));
      return results;
    }),
  );
  return all.flat();
}

test('time to first token and inter-token gaps as concurrency rises', async () => {
  const report: Record<string, unknown> = {};
  const metrics: Record<string, number> = {};
  for (const clients of STEPS) {
    const t0 = performance.now();
    const results = await step(clients);
    const seconds = (performance.now() - t0) / 1000;
    const ok = results.filter((r) => r.status === 200 && r.done);
    const ttft = summarize(ok.map((r) => r.ttftMs!).filter((v) => v !== null));
    const gaps = summarize(ok.flatMap((r) => r.gapsMs));
    const statuses: Record<number, number> = {};
    for (const r of results) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    report[`c${clients}`] = {
      clients,
      requests: results.length,
      errors: results.length - ok.length,
      statuses,
      requestsPerSec: Math.round((ok.length / seconds) * 10) / 10,
      ttftMs: ttft,
      interTokenMs: gaps,
    };
    metrics[`c${clients}.ttft.p95`] = ttft.p95;
    metrics[`c${clients}.gap.p95`] = gaps.p95;
    console.log(
      `c=${clients}: ${ok.length}/${results.length} ok, ${(ok.length / seconds).toFixed(1)} req/s, ` +
        `ttft p50/p95 ${ttft.p50}/${ttft.p95} ms, gap p50/p95 ${gaps.p50}/${gaps.p95} ms`,
    );
    // Up to as many clients as nodes, nothing may be refused.
    if (clients <= NODES) expect(ok.length, `errors at ${clients} clients`).toBe(results.length);
    // Every answer carries exactly the pieces the node sent.
    for (const r of ok) expect(r.pieces).toBe(TOKENS);
  }
  writeResult('streaming-ttft', { nodes: NODES, tokens: TOKENS, steps: report, metrics });
  expect(regressions('streaming-ttft', metrics)).toEqual([]);
});

test('the usage the gateway records equals what the nodes sent', async () => {
  const { requests, pieces } = fleet.totals();
  expect(requests).toBeGreaterThan(0);
  // The gateway flushes its counters in batches, so wait for the totals to settle.
  const totals = await waitFor(
    'the usage totals to match',
    async () => {
      const t = (await fleet.ws.cp.usageByKey(fleet.ws.org.id)).totals;
      return t.requests === requests && t.tokensOut === pieces ? t : undefined;
    },
    90_000,
    2_000,
  ).catch(async () => (await fleet.ws.cp.usageByKey(fleet.ws.org.id)).totals);
  expect({ requests: totals.requests, tokensOut: totals.tokensOut }).toEqual({
    requests,
    tokensOut: pieces,
  });
});
