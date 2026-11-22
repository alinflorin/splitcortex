import { expect, test, type Page } from '@playwright/test';
import { api, poolNodes, uniq, userPage } from '../lib/api';
import { accessToken } from '../lib/auth';
import { CliNode } from '../lib/cliNodes';
import { authFile, baseUrl, CHAT_MODEL, optional } from '../lib/env';
import {
  chat,
  fakeText,
  lagMonitor,
  now,
  Recorder,
  runPool,
  sleep,
  type ChatTiming,
} from '../lib/perf';
import { loadState } from '../lib/state';

// Performance of OUR code, not of a model or of the machine: the gateway (relay, balancing, refusals, failover), the
// control plane's API and the metering, measured from a client on the CI runner against stg. The devices are a fleet of
// fake CLI nodes (`run --fake`: the real node, synthetic tokens at a fixed pace, no model), so what is left in the
// numbers is the platform. Runs after every other e2e job has passed (see e2e.yaml), on one worker.
//
// Timings are only reported (results.json, summary.md, and compared with the previous run); the assertions here are
// about correctness under load: every answer complete and exact, refusals only of the documented kinds, nothing hung.
// PERF_ENFORCE=1 also fails the run on a regression against the previous results. PERF_NODES sets the fleet size.
test.describe.configure({ mode: 'serial' });
test.use({ storageState: authFile(0) });
test.setTimeout(45 * 60_000);

const NODES = Number(optional('PERF_NODES') ?? 12);
const FAKE = { firstTokenMs: 20, tokensPerSec: 100 };
const GAP_MS = 1000 / FAKE.tokensPerSec;
/** What a streamed answer of n tokens takes with no platform in the way. */
const ideal = (n: number) => FAKE.firstTokenMs + (n - 1) * GAP_MS;
/** Enrollment is limited to 30 calls a minute per address and a device uses two: one device every 6 s is 20. */
const ENROLL_EVERY_MS = 6_000;

let page: Page;
let orgId: string;
let org: (path?: string) => string;
let poolId: string;
let keyId: string;
let key: string;
const fleet: CliNode[] = [];
const rec = new Recorder();
const lag = lagMonitor();
let sentToPool = 0; // requests the gateway accepted for the pool (for the metering check)

const body = (tokens: number, extra: object = {}) => ({
  model: CHAT_MODEL.name,
  messages: [{ role: 'user', content: 'perf' }],
  max_tokens: tokens,
  ...extra,
});

async function nodeLive(id: string) {
  const r = await api<{ live: { backend: string | null } | null }>(
    page,
    'GET',
    org(`/nodes/${id}`),
  );
  return r.body.live?.backend ?? null;
}

/** Every device online and with its model loaded (a loading device gets no traffic). */
async function fleetReady(expected: number, timeoutMs = 10 * 60_000) {
  await expect
    .poll(
      async () => {
        const online = (await poolNodes(page, orgId, poolId)).filter((n) => n.status === 'online');
        if (online.length < expected) return online.length;
        const loaded = await Promise.all(online.map((n) => nodeLive(n.id)));
        return loaded.every((b) => b !== null) ? expected : -1;
      },
      { timeout: timeoutMs, intervals: [2_000], message: 'the fleet never became ready' },
    )
    .toBe(expected);
}

test.beforeAll(async ({ browser }) => {
  page = await userPage(browser, 0);
  const state = loadState();
  orgId = state.orgId;
  org = (path = '') => `/organisations/${orgId}${path}`;
  const models = (await api<{ id: string; name: string }[]>(page, 'GET', org('/models'))).body;
  const chatModel = models.find((m) => m.name === CHAT_MODEL.name);
  expect(chatModel, 'the e2e chat model exists (setup)').toBeTruthy();

  // Left over from a crashed run.
  for (const p of (await api<{ id: string; name: string }[]>(page, 'GET', org('/pools'))).body) {
    if (p.name.startsWith('e2e-perf-')) await api(page, 'DELETE', org(`/pools/${p.id}`));
  }
  for (const k of (await api<{ id: string; name: string }[]>(page, 'GET', org('/api-keys'))).body) {
    if (k.name.startsWith('e2e-perf-')) await api(page, 'DELETE', org(`/api-keys/${k.id}`));
  }

  const pool = await api<{ id: string }>(page, 'POST', org('/pools'), {
    name: `e2e-perf-${uniq()}`,
    balancingType: 'least_in_flight',
  });
  expect(pool.status, JSON.stringify(pool.body)).toBe(201);
  poolId = pool.body.id;
  expect((await api(page, 'PUT', org(`/pools/${poolId}/models/${chatModel!.id}`))).status).toBe(
    204,
  );
  const k = await api<{ key: { id: string }; secret: string }>(page, 'POST', org('/api-keys'), {
    name: `e2e-perf-${uniq()}`,
    scope: 'pools',
    poolIds: [poolId],
  });
  expect(k.status, JSON.stringify(k.body)).toBe(201);
  key = k.body.secret;
  keyId = k.body.key.id;
  rec.info.nodes = NODES;
  rec.info.fake = FAKE;
  rec.info.baseUrl = baseUrl();
  rec.info.runner = process.env.RUNNER_NAME ?? 'local';
});

test.afterAll(async () => {
  lag.stop();
  for (const n of fleet) await n.dispose();
  await api(page, 'DELETE', org(`/api-keys/${keyId}`));
  await api(page, 'DELETE', org(`/pools/${poolId}`));
  await page.context().close();
});

test.afterAll(async () => {
  // After the cleanup above, so a regression never leaves devices behind.
  const regressions = rec.write();
  if (regressions.length) {
    test
      .info()
      .annotations.push(...regressions.map((r) => ({ type: 'perf-regression', description: r })));
    if (process.env.PERF_ENFORCE === '1')
      throw new Error(`Slower than before:\n${regressions.join('\n')}`);
  }
});

test('a fleet of fake devices enrolls and comes online', async () => {
  const started = now();
  const bulk = await api<{ items: { code: string }[] }>(
    page,
    'POST',
    org(`/pools/${poolId}/enrollments/bulk`),
    { count: NODES },
  );
  expect(bulk.status, JSON.stringify(bulk.body)).toBe(201);
  let nextSlot = Date.now();
  for (let i = 0; i < NODES; i++) {
    const wait = nextSlot - Date.now();
    if (wait > 0) await sleep(wait);
    nextSlot = Date.now() + ENROLL_EVERY_MS;
    const node = new CliNode(FAKE);
    fleet.push(node);
    await node.enroll(bulk.body.items[i]!.code);
    await node.start();
  }
  await fleetReady(NODES);
  rec.value(
    'fleet: enrol, connect and load',
    (now() - started) / 1000,
    's',
    `${NODES} fake devices, one every 6 s`,
  );

  // Warm up: connections, caches, the gateway's first pick.
  for (let i = 0; i < 10; i++) await chat(baseUrl(), key, body(4));
  lag.reset();
});

test('one request at a time: the gateway adds little to the device', async () => {
  const total = 60;
  const results: ChatTiming[] = [];
  for (let i = 0; i < total; i++) results.push(await chat(baseUrl(), key, body(1)));
  expect(results.map((r) => r.status)).toEqual(Array(total).fill(200));
  expect(results.every((r) => r.text === fakeText(1))).toBe(true);
  sentToPool += total;
  rec.add(
    'non-streaming, 1 token: total',
    results.map((r) => r.totalMs),
  );
  rec.add(
    'non-streaming, 1 token: platform overhead',
    results.map((r) => r.totalMs - ideal(1)),
    'ms',
    "total minus the fake device's own time",
  );
});

test('a stream: time to the first token and per-token overhead', async () => {
  const tokens = 32;
  const total = 40;
  const results: ChatTiming[] = [];
  for (let i = 0; i < total; i++)
    results.push(await chat(baseUrl(), key, body(tokens), { stream: true }));
  for (const r of results) {
    expect(r.status).toBe(200);
    expect(r.done, 'ends with [DONE]').toBe(true);
    expect(r.text, 'every token arrived, in order, exactly once').toBe(fakeText(tokens));
  }
  sentToPool += total;
  rec.add(
    'stream: time to first token',
    results.map((r) => r.ttfbMs),
  );
  rec.add(
    'stream: first-token overhead',
    results.map((r) => r.ttfbMs - FAKE.firstTokenMs),
    'ms',
    "minus the fake device's 20 ms",
  );
  rec.add(
    'stream: total',
    results.map((r) => r.totalMs),
    'ms',
    `ideal ${ideal(tokens).toFixed(0)}`,
  );
  rec.add(
    'stream: platform overhead',
    results.map((r) => r.totalMs - ideal(tokens)),
  );
  rec.add(
    'stream: gap between tokens',
    results.flatMap((r) => r.gaps),
    'ms',
    `ideal ${GAP_MS}`,
  );
});

test('concurrent streams, up to one per device', async () => {
  const tokens = 32;
  for (const concurrency of [...new Set([1, Math.ceil(NODES / 2), NODES])]) {
    const rounds = 4;
    const all: ChatTiming[] = [];
    for (let r = 0; r < rounds; r++) {
      all.push(
        ...(await Promise.all(
          Array.from({ length: concurrency }, () =>
            chat(baseUrl(), key, body(tokens), { stream: true }),
          ),
        )),
      );
    }
    const ok = all.filter((r) => r.status === 200);
    for (const r of ok) expect(r.text, 'exact answer under load').toBe(fakeText(tokens));
    const refused = all.filter((r) => r.status !== 200);
    for (const r of refused)
      expect([429, 503], `refusal kinds, got ${r.status} ${r.error ?? ''}`).toContain(r.status);
    // Up to half the fleet nothing may be refused; with every device busy at once, two requests may meet on one.
    const minimum = concurrency <= Math.ceil(NODES / 2) ? 1 : 0.8;
    expect(ok.length / all.length, `served at ${concurrency} at once`).toBeGreaterThanOrEqual(
      minimum,
    );
    sentToPool += ok.length;
    const label = `streams x${concurrency}`;
    rec.add(
      `${label}: time to first token`,
      ok.map((r) => r.ttfbMs),
    );
    rec.add(
      `${label}: platform overhead`,
      ok.map((r) => r.totalMs - ideal(tokens)),
    );
    rec.value(`${label}: served`, (ok.length / all.length) * 100, '%');
  }
});

test('more streams than devices: served or refused, quickly, never hung', async () => {
  const tokens = 64;
  const total = NODES * 4;
  const all = await Promise.all(
    Array.from({ length: total }, () =>
      chat(baseUrl(), key, body(tokens), { stream: true, timeoutMs: 90_000 }),
    ),
  );
  const hung = all.filter((r) => r.status === 0);
  expect(
    hung.map((r) => r.error),
    'no request may hang or fail on the network',
  ).toEqual([]);
  for (const r of all) expect([200, 429, 503]).toContain(r.status);
  const ok = all.filter((r) => r.status === 200);
  const refused = all.filter((r) => r.status !== 200);
  expect(ok.length, 'some are served').toBeGreaterThan(0);
  for (const r of ok) expect(r.text).toBe(fakeText(tokens));
  sentToPool += ok.length;
  rec.value('overload: served', ok.length, 'count', `of ${total} at once on ${NODES} devices`);
  rec.value('overload: refused', refused.length, 'count');
  if (refused.length)
    rec.add(
      'overload: time to a refusal',
      refused.map((r) => r.totalMs),
    );
  rec.add(
    'overload: time to first token of the served',
    ok.map((r) => r.ttfbMs),
  );
});

test('cheap paths: model list, wrong key, unknown model', async () => {
  const get = async (path: string, auth: string | null) => {
    const t = now();
    const res = await fetch(`${baseUrl()}/v1${path}`, {
      headers: auth ? { authorization: `Bearer ${auth}` } : {},
      signal: AbortSignal.timeout(30_000),
    });
    await res.text();
    return { status: res.status, ms: now() - t };
  };
  const models = await runPool(200, 10, () => get('/models', key));
  expect(models.every((r) => r.status === 200)).toBe(true);
  rec.add(
    'GET /v1/models (10 at once)',
    models.map((r) => r.ms),
  );

  const wrongKey = await runPool(200, 10, () => get('/models', 'sk-not-a-real-key'));
  expect(wrongKey.every((r) => r.status === 401)).toBe(true);
  rec.add(
    'wrong key refused (10 at once)',
    wrongKey.map((r) => r.ms),
  );

  const unknown = await runPool(100, 10, async () => {
    const r = await chat(baseUrl(), key, { ...body(1), model: 'no-such-model' });
    return r;
  });
  expect(unknown.every((r) => r.status === 404)).toBe(true);
  rec.add(
    'unknown model refused (10 at once)',
    unknown.map((r) => r.totalMs),
  );
});

test('a device dies under load: the pool recovers; the device comes back', async () => {
  const victim = fleet[0]!;
  const concurrency = Math.max(2, Math.floor(NODES / 3));
  const durationMs = 20_000;
  const killAtMs = 5_000;
  const started = now();
  const log: { at: number; status: number; ms: number }[] = [];
  let stop = false;
  const worker = async () => {
    while (!stop) {
      const t = now();
      const r = await chat(baseUrl(), key, body(8), { stream: true, timeoutMs: 30_000 });
      log.push({
        at: t - started,
        status: r.status === 200 && r.text !== fakeText(8) ? -1 : r.status,
        ms: r.totalMs,
      });
    }
  };
  const workers = Array.from({ length: concurrency }, worker);
  await sleep(killAtMs);
  const killedAt = now() - started;
  await victim.kill();
  await sleep(durationMs - killAtMs);
  stop = true;
  await Promise.all(workers);

  const after = log.filter((l) => l.at > killedAt);
  const failures = after.filter((l) => l.status !== 200);
  const before = log.filter((l) => l.at <= killedAt && l.status !== 200);
  expect(before, 'nothing fails before the kill').toEqual([]);
  // A request cut in the middle may fail; the pool must be serving again within seconds.
  const lastFailure = failures.reduce((m, l) => Math.max(m, l.at + l.ms), killedAt);
  rec.value(
    'failover: requests failed after the kill',
    failures.length,
    'count',
    `${concurrency} clients, 1 of ${NODES} devices killed`,
  );
  rec.value('failover: time until no more failures', lastFailure - killedAt, 'ms');
  expect(lastFailure - killedAt, 'the pool keeps serving within 15 s').toBeLessThan(15_000);
  expect(failures.length, 'only the requests on the dead device fail').toBeLessThanOrEqual(
    concurrency,
  );
  rec.add(
    'failover: latency of the requests that kept succeeding',
    after.filter((l) => l.status === 200).map((l) => l.ms),
  );
  sentToPool += log.filter((l) => l.status === 200).length;

  // Back again: a new process with the same identity.
  const restarted = now();
  await victim.start();
  await expect
    .poll(
      async () =>
        (await poolNodes(page, orgId, poolId)).find((n) => n.id === victim.nodeId)?.status,
      {
        timeout: 120_000,
        intervals: [250],
      },
    )
    .toBe('online');
  rec.value('reconnect: process start to online', now() - restarted, 'ms');
  await expect
    .poll(async () => await nodeLive(victim.nodeId), { timeout: 120_000, intervals: [250] })
    .not.toBeNull();
  rec.value('reconnect: process start to serving', now() - restarted, 'ms');
});

test('control plane: reads and writes', async () => {
  const token = await accessToken(page);
  const call = async (method: string, path: string, data?: object) => {
    const t = now();
    const res = await fetch(`${baseUrl()}/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(data ? { 'content-type': 'application/json' } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    return { status: res.status, ms: now() - t, text };
  };
  const reads: [string, string][] = [
    ['GET /me', '/me'],
    ['GET organisations', '/organisations'],
    ['GET pools', org('/pools')],
    ['GET pool devices', org(`/pools/${poolId}/nodes`)],
    ['GET api keys', org('/api-keys')],
    ['GET usage', org('/usage')],
    ["GET metrics (with this run's traffic)", org(`/metrics?poolId=${poolId}`)],
    ['GET audit log', org('/audit-logs?limit=50')],
  ];
  for (const [name, path] of reads) {
    const r = await runPool(60, 5, () => call('GET', path));
    expect(
      r.map((x) => x.status),
      name,
    ).toEqual(Array(60).fill(200));
    rec.add(
      `${name} (5 at once)`,
      r.map((x) => x.ms),
    );
  }

  // The write path, with its audit record: create and delete an API key.
  const create: number[] = [];
  const remove: number[] = [];
  for (let i = 0; i < 20; i++) {
    const c = await call('POST', org('/api-keys'), {
      name: `e2e-perf-write-${uniq()}`,
      scope: 'pools',
      poolIds: [poolId],
    });
    expect(c.status, c.text).toBe(201);
    create.push(c.ms);
    const id = (JSON.parse(c.text) as { key: { id: string } }).key.id;
    const d = await call('DELETE', org(`/api-keys/${id}`));
    expect(d.status).toBe(204);
    remove.push(d.ms);
  }
  rec.add('POST api key', create);
  rec.add('DELETE api key', remove);
});

test('metering catches up with the traffic', async () => {
  // The gateway writes counters in batches: how long until the control plane shows every request served above?
  const started = now();
  const counted = async () => {
    const m = await api<{ nodes: { requests: number }[] }>(
      page,
      'GET',
      org(`/metrics?poolId=${poolId}`),
    );
    return m.body.nodes.reduce((sum, n) => sum + n.requests, 0);
  };
  await expect
    .poll(counted, {
      timeout: 6 * 60_000,
      intervals: [2_000],
      message: 'the gateway never wrote the counts',
    })
    .toBeGreaterThanOrEqual(sentToPool);
  rec.value(
    'metering: all requests visible after',
    (now() - started) / 1000,
    's',
    `${sentToPool} requests, batched writes`,
  );

  const { p99, max } = lag.read();
  rec.value(
    'client event-loop lag p99',
    p99,
    'ms',
    'this runner, not the platform: high means the numbers above are client-bound',
  );
  rec.value('client event-loop lag max', max, 'ms');
});
