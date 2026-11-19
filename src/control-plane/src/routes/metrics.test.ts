import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nodeMetrics, poolMetrics, usageRecords } from '../db/schema';
import { pruneMetrics } from '../db/metrics-prune';
import { LATENCY_BUCKETS, type MetricsDto } from '../dto';
import { percentileMs } from './metrics';
import { createTestApp } from '../test/harness';

type T = Awaited<ReturnType<typeof createTestApp>>;
let t: T;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const call = (method: 'GET' | 'POST', url: string, user: string, payload?: object) =>
  t.app.inject({ method, url: `/api${url}`, headers: t.as(user), payload });
const mkOrg = async (owner: string, slug: string) =>
  (await call('POST', '/organisations', owner, { name: slug, slug })).json<{ id: string }>().id;
const hist = (at: number, n: number) => {
  const h = new Array<number>(LATENCY_BUCKETS).fill(0);
  h[at] = n;
  return h;
};
const minute = (agoMin: number) =>
  new Date(Math.floor(Date.now() / 60_000) * 60_000 - agoMin * 60_000);

describe('percentileMs', () => {
  it('returns the upper bound of the bucket holding the percentile', () => {
    expect(percentileMs(new Array(LATENCY_BUCKETS).fill(0), 0.5)).toBeNull();
    const h = new Array<number>(LATENCY_BUCKETS).fill(0);
    h[0] = 90; // <= 100 ms
    h[3] = 10; // <= 1000 ms
    expect(percentileMs(h, 0.5)).toBe(100);
    expect(percentileMs(h, 0.95)).toBe(1000);
  });
});

describe('metrics', () => {
  it('adds up steps, merges usage and node telemetry, and is tenant scoped', async () => {
    const a = await mkOrg('own@m.io', 'met-a');
    const b = await mkOrg('own@m.io', 'met-b');
    const pool = crypto.randomUUID();
    const node = crypto.randomUUID();
    const base = { orgId: a, poolId: pool, rateLimited: 0, unavailable: 0, peakInFlight: 1 };
    await t.db.insert(poolMetrics).values([
      { ...base, bucket: minute(2), rateLimited: 2, latencyHist: hist(0, 9), ttftHist: hist(0, 9) },
      {
        ...base,
        bucket: minute(1),
        unavailable: 1,
        peakInFlight: 4,
        latencyHist: hist(3, 1),
        ttftHist: hist(1, 1),
      },
      // another organisation's row must never show
      {
        ...base,
        orgId: b,
        bucket: minute(1),
        rateLimited: 99,
        latencyHist: hist(9, 5),
        ttftHist: hist(9, 5),
      },
    ]);
    await t.db.insert(usageRecords).values({
      bucket: minute(1),
      orgId: a,
      poolId: pool,
      keyId: crypto.randomUUID(),
      model: 'm',
      tokensIn: 5,
      tokensOut: 7,
      requests: 10,
      errors: 1,
    });
    await t.db.insert(nodeMetrics).values([
      {
        bucket: minute(2),
        nodeId: node,
        orgId: a,
        poolId: pool,
        cpuPercent: 10,
        batteryPercent: 80,
        inFlight: 1,
        tokensPerSec: 20,
      },
      {
        bucket: minute(1),
        nodeId: node,
        orgId: a,
        poolId: pool,
        cpuPercent: 30,
        batteryPercent: 70,
        inFlight: 3,
        tokensPerSec: 0,
      },
    ]);

    const res = await call(
      'GET',
      `/organisations/${a}/metrics?step=1h&from=${minute(30).toISOString()}&to=${new Date(Date.now() + 60_000).toISOString()}`,
      'own@m.io',
    );
    expect(res.statusCode).toBe(200);
    const m = res.json<MetricsDto>();
    const total = m.pools.reduce((s, p) => s + p.rateLimited, 0);
    expect(total).toBe(2); // org b's 99 stays out
    expect(m.pools.reduce((s, p) => s + p.unavailable, 0)).toBe(1);
    expect(Math.max(...m.pools.map((p) => p.peakInFlight))).toBe(4);
    expect(m.pools.reduce((s, p) => s + p.requests, 0)).toBe(10);
    expect(m.pools.reduce((s, p) => s + p.tokensOut, 0)).toBe(7);
    expect(m.pools.some((p) => p.latencyP50Ms === 100)).toBe(true);
    const n = m.nodes.reduce((s, p) => s + (p.cpuPercent ?? 0), 0);
    expect(n).toBeGreaterThan(0);
    expect(Math.min(...m.nodes.map((p) => p.batteryPercent ?? 999))).toBe(70);

    // node filter and non-member
    const one = await call('GET', `/organisations/${a}/metrics?nodeId=${node}`, 'own@m.io');
    expect(one.statusCode).toBe(200);
    expect((await call('GET', `/organisations/${a}/metrics`, 'out@m.io')).statusCode).toBe(404);
    expect(
      (
        await call(
          'GET',
          `/organisations/${a}/metrics?from=2020-01-01T00:00:00Z&to=2021-01-01T00:00:00Z`,
          'own@m.io',
        )
      ).statusCode,
    ).toBe(400);
  });

  it('prunes rows older than the retention window', async () => {
    const o = await mkOrg('own@p.io', 'met-prune');
    const pool = crypto.randomUUID();
    await t.db.insert(poolMetrics).values([
      {
        orgId: o,
        poolId: pool,
        bucket: minute(8 * 1440),
        latencyHist: hist(0, 1),
        ttftHist: hist(0, 1),
      },
      { orgId: o, poolId: pool, bucket: minute(10), latencyHist: hist(0, 1), ttftHist: hist(0, 1) },
    ]);
    await t.db
      .insert(nodeMetrics)
      .values({ bucket: minute(8 * 1440), nodeId: crypto.randomUUID(), orgId: o, poolId: pool });
    expect(await pruneMetrics({ db: t.db, retentionDays: 7 })).toBe(2);
    expect(await pruneMetrics({ db: t.db, retentionDays: 7 })).toBe(0);
  });
});
