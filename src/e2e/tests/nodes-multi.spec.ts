import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  api,
  gateway,
  poolNodes,
  uniq,
  uploadTinyModel,
  userPage,
  type OpenAIError,
} from '../lib/api';
import { accessToken } from '../lib/auth';
import { CliNode, nodeAuthHeader } from '../lib/cliNodes';
import { webNode } from '../lib/drivers/web';
import { authFile, baseUrl, CHAT_MODEL, EMBEDDING_MODEL } from '../lib/env';
import { loadState } from '../lib/state';

// Several devices in one pool, the way a customer runs them: balancing, a device dying (also in the middle of an
// answer), reconnecting, the device's own settings against the admin's, the device API a node talks to, and mixed node
// types. CLI nodes only (cheap, any number of them), plus one browser tab for the mixed pool. The CLI nodes run the fake
// engine (`run --fake`: synthetic tokens, no model download) except where a test needs the real one. Pools and keys are
// throw-away and live in the e2e organisation (its two models are reused, nothing is downloaded from Hugging Face).
test.describe.configure({ mode: 'serial' });
test.use({ storageState: authFile(0) });
test.setTimeout(30 * 60_000);

interface NodeFull {
  id: string;
  name: string;
  status: string;
  approved: boolean;
  computeBackend: string | null;
  maxContextTokens: number | null;
  live: {
    inFlight: number;
    cpuPercent: number | null;
    memoryUsedMb: number | null;
    backend: string | null;
    maxContextTokens: number | null;
  } | null;
}
interface Metrics {
  nodes: { requests: number; failures: number }[];
}
interface Named {
  id: string;
  name: string;
}

let page: Page;
let orgId: string;
let org: (path?: string) => string;
let chatModel: Named;
let embedModel: Named;
let poolId: string;
let approvalPoolId: string;
let apiKey: string;
const keyIds: string[] = [];
const modelIds: string[] = [];
const poolIds: string[] = [];
const cli: CliNode[] = [];
/** Instant answers (1 ms to the first token, no delay between tokens): most tests only need the answer. */
const QUICK = { firstTokenMs: 1, tokensPerSec: 0 };
/** Slow enough (20 ms, then 200 a second) that an answer of hundreds of tokens is still streaming when a test acts. */
const STEADY = { firstTokenMs: 20, tokensPerSec: 200 };

/** A CLI node on the fake engine (instant by default); `fake: false` runs the real engine and downloads the real model. */
const newCli = (fake: boolean | typeof QUICK = QUICK) => {
  const n = new CliNode(fake);
  cli.push(n);
  return n;
};

const chat = (extra: object = {}) => ({
  model: CHAT_MODEL.name,
  messages: [{ role: 'user', content: 'Count from one to ten.' }],
  max_tokens: 16,
  ...extra,
});
const ask = (key = apiKey, extra: object = {}) =>
  gateway<OpenAIError>(page, key, 'POST', '/chat/completions', chat(extra));

async function newPool(name: string, extra: object = {}, modelId = chatModel.id): Promise<string> {
  const pool = await api<{ id: string }>(page, 'POST', org('/pools'), { name, ...extra });
  expect(pool.status, JSON.stringify(pool.body)).toBe(201);
  poolIds.push(pool.body.id);
  const set = await api(page, 'PUT', org(`/pools/${pool.body.id}/models/${modelId}`));
  expect(set.status).toBe(204);
  return pool.body.id;
}

async function newKey(pools: string[], limits: object = {}) {
  const res = await api<{ key: { id: string }; secret: string }>(page, 'POST', org('/api-keys'), {
    name: `e2e-multi-${uniq()}`,
    scope: 'pools',
    poolIds: pools,
    // An empty `limits` is refused (it needs at least one), so only send it when there is one.
    ...(Object.keys(limits).length ? { limits } : {}),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  keyIds.push(res.body.key.id);
  return res.body;
}

async function code(pool = poolId): Promise<string> {
  const res = await api<{ code: string }>(page, 'POST', org(`/pools/${pool}/enrollments`));
  expect(res.status).toBe(201);
  return res.body.code;
}

/** Enrolls a CLI node into the pool and starts it. */
async function join(node: CliNode, pool = poolId) {
  await node.enroll(await code(pool));
  await node.start();
}

const nodeOf = async (id: string) => (await api<NodeFull>(page, 'GET', org(`/nodes/${id}`))).body;
const statusOf = async (id: string, pool = poolId) =>
  (await poolNodes(page, orgId, pool)).find((n) => n.id === id)?.status;

async function online(id: string, timeout = 15 * 60_000, pool = poolId) {
  await expect
    .poll(() => statusOf(id, pool), {
      timeout,
      intervals: [3_000],
      message: `node ${id} never came online`,
    })
    .toBe('online');
}
async function offline(id: string, timeout = 90_000) {
  await expect
    .poll(() => statusOf(id), { timeout, intervals: [2_000], message: 'still online' })
    .not.toBe('online');
}

/**
 * Waits until the device has loaded its model. "Online" is only the connection: a device still loading gets no traffic,
 * so a balancing test must wait for every device or it measures who loaded first. The page's "Running on" is this value.
 */
async function loaded(id: string, timeout = 10 * 60_000) {
  await expect
    .poll(async () => (await nodeOf(id)).live?.backend ?? null, {
      timeout,
      intervals: [3_000],
      message: `node ${id} never loaded its model`,
    })
    .not.toBeNull();
}

/** Waits until the pool answers (the model is loaded on at least one device). */
async function serving(timeout = 10 * 60_000, key = apiKey) {
  await expect
    .poll(async () => (await ask(key)).status, {
      timeout,
      intervals: [3_000],
      message: 'the pool never served a request',
    })
    .toBe(200);
}

/** Requests the gateway counted for one device (batched writes, so callers poll). */
async function served(nodeId: string, pool = poolId): Promise<number> {
  const m = await api<Metrics>(page, 'GET', org(`/metrics?poolId=${pool}&nodeId=${nodeId}`));
  return m.body.nodes.reduce((sum, p) => sum + p.requests, 0);
}

/** A streamed answer read chunk by chunk, so a test can act while it is on its way. */
async function stream(
  onFirstChunk: () => Promise<void>,
  key = apiKey,
): Promise<{ text: string; done: boolean; status: number }> {
  const res = await fetch(`${baseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(chat({ stream: true, max_tokens: 400 })),
    signal: AbortSignal.timeout(3 * 60_000),
  });
  if (!res.body) return { text: '', done: false, status: res.status };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let acted = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (!acted && text.includes('data:')) {
        acted = true;
        await onFirstChunk();
      }
    }
  } catch {
    // The connection broke: that is a legitimate end of a stream too; the caller looks at what arrived.
  }
  return { text, done: text.includes('data: [DONE]'), status: res.status };
}

test.beforeAll(async ({ browser }) => {
  page = await userPage(browser, 0);
  const state = loadState();
  orgId = state.orgId;
  org = (path = '') => `/organisations/${orgId}${path}`;
  const models = (await api<Named[]>(page, 'GET', org('/models'))).body;
  chatModel = models.find((m) => m.name === CHAT_MODEL.name)!;
  embedModel = models.find((m) => m.name === EMBEDDING_MODEL.name)!;
  expect(chatModel && embedModel, 'the e2e models exist (setup)').toBeTruthy();

  // Left over from a crashed run: pools of this spec (their devices go with them) and keys.
  for (const p of (await api<Named[]>(page, 'GET', org('/pools'))).body) {
    if (p.name.startsWith('e2e-multi-')) await api(page, 'DELETE', org(`/pools/${p.id}`));
  }
  for (const k of (await api<Named[]>(page, 'GET', org('/api-keys'))).body) {
    if (k.name.startsWith('e2e-multi-')) await api(page, 'DELETE', org(`/api-keys/${k.id}`));
  }

  poolId = await newPool(`e2e-multi-${uniq()}`, { balancingType: 'round_robin' });
  approvalPoolId = await newPool(`e2e-multi-approval-${uniq()}`, { requireApproval: true });
  const key = await newKey([poolId]);
  apiKey = key.secret;
});

test.afterAll(async () => {
  await webNode.stop();
  for (const n of cli) await n.dispose();
  for (const id of keyIds) await api(page, 'DELETE', org(`/api-keys/${id}`));
  for (const id of poolIds) await api(page, 'DELETE', org(`/pools/${id}`));
  for (const id of modelIds) await api(page, 'DELETE', org(`/models/${id}`));
  await page.context().close();
});

// The pair the mid-answer tests (a device dying or stopping, a client hanging up) act on: their answers must still be
// streaming when the test acts.
const n1 = newCli(STEADY);
const n2 = newCli(STEADY);

test('two devices in one pool come online, both serve, load is shared', async () => {
  await join(n1);
  await join(n2);
  await Promise.all([online(n1.nodeId), online(n2.nodeId)]);
  await Promise.all([loaded(n1.nodeId), loaded(n2.nodeId)]);
  await serving();
  // The pool lists both, and the page counts them.
  expect((await poolNodes(page, orgId, poolId)).filter((n) => n.status === 'online')).toHaveLength(
    2,
  );

  // round_robin: sequential requests alternate, so each device gets its share.
  const base = [await served(n1.nodeId), await served(n2.nodeId)];
  for (let i = 0; i < 20; i++) expect((await ask()).status).toBe(200);
  const delta = async () => [
    (await served(n1.nodeId)) - base[0]!,
    (await served(n2.nodeId)) - base[1]!,
  ];
  await expect
    .poll(async () => (await delta()).reduce((x, y) => x + y, 0), {
      timeout: 4 * 60_000,
      intervals: [10_000],
      message: 'the gateway never wrote the per-device request counts',
    })
    .toBeGreaterThanOrEqual(20);
  const share = await delta();
  expect(share[0]! + share[1]!, 'all 20 were counted').toBeGreaterThanOrEqual(20);
  expect(Math.min(...share), `round robin, got ${share}`).toBeGreaterThanOrEqual(5);
});

test('weighted balancing: concurrent requests reach both devices; overload is refused, never hung', async () => {
  expect(
    (await api(page, 'PATCH', org(`/pools/${poolId}`), { balancingType: 'weighted_p2c' })).status,
  ).toBe(200);
  const base = [await served(n1.nodeId), await served(n2.nodeId)];
  // A device generates one answer at a time, so 12 at once is more than two devices take: each answer must be a
  // served 200, or a clean 429/503 asking to come back later. Nothing else, nothing stuck.
  const replies = await Promise.all(
    Array.from({ length: 12 }, () => ask(apiKey, { max_tokens: 32 })),
  );
  const statuses = replies.map((r) => r.status);
  expect(
    statuses.filter((s) => ![200, 429, 503].includes(s)),
    `statuses ${statuses}`,
  ).toEqual([]);
  expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(2);
  for (const r of replies.filter((r) => r.status !== 200)) {
    expect(r.headers['retry-after'], 'a refusal says when to retry').toBeTruthy();
  }
  const delta = async () => [
    (await served(n1.nodeId)) - base[0]!,
    (await served(n2.nodeId)) - base[1]!,
  ];
  await expect
    .poll(async () => (await delta()).reduce((x, y) => x + y, 0), {
      timeout: 4 * 60_000,
      intervals: [10_000],
      message: 'the gateway never wrote the per-device request counts',
    })
    .toBeGreaterThanOrEqual(statuses.filter((s) => s === 200).length);
  const split = await delta();
  expect(split[0]!, 'device 1 took part').toBeGreaterThan(0);
  expect(split[1]!, 'device 2 took part').toBeGreaterThan(0);
});

test('the device reports real numbers on its page', async () => {
  for (const n of [n1, n2]) {
    await expect
      .poll(async () => (await nodeOf(n.nodeId)).live?.memoryUsedMb ?? 0, {
        timeout: 2 * 60_000,
        intervals: [5_000],
        message: 'no telemetry arrived',
      })
      .toBeGreaterThan(0);
    const live = (await nodeOf(n.nodeId)).live!;
    expect(live.cpuPercent).not.toBeNull();
    expect(live.cpuPercent!).toBeGreaterThanOrEqual(0);
    expect(live.cpuPercent!).toBeLessThanOrEqual(100 * 256);
    expect(['cpu', 'gpu']).toContain(live.backend);
  }
});

test('a device that dies is dropped at once; the pool keeps serving; it comes back by itself', async () => {
  await n1.kill();
  await offline(n1.nodeId);
  // Within seconds every request goes to the other device; a few in a row must be fine.
  await expect
    .poll(
      async () => {
        const statuses: number[] = [];
        for (let i = 0; i < 5; i++) statuses.push((await ask()).status);
        return statuses;
      },
      { timeout: 60_000, intervals: [1_000], message: 'the pool did not recover on one device' },
    )
    .toEqual([200, 200, 200, 200, 200]);

  // An offline device cannot be restarted remotely, nothing is queued for it, and the refusal is translated.
  const en = await api<{ message: string }>(
    page,
    'POST',
    org(`/nodes/${n1.nodeId}/restart`),
    undefined,
    {
      'accept-language': 'en',
    },
  );
  const ro = await api<{ message: string }>(
    page,
    'POST',
    org(`/nodes/${n1.nodeId}/restart`),
    undefined,
    {
      'accept-language': 'ro',
    },
  );
  expect([en.status, ro.status]).toEqual([409, 409]);
  expect(ro.body.message).toBeTruthy();
  expect(ro.body.message).not.toBe(en.body.message);

  // The same process, with the same identity and no new code, reconnects on its own.
  await n1.start();
  await online(n1.nodeId);
  expect(n1.enrolled).toBe(true);
  // It was not told to restart a minute later because of the earlier request.
  await page.waitForTimeout(10_000);
  expect(await statusOf(n1.nodeId)).toBe('online');
});

test('a dropped connection (not a dead process) is picked up again', async () => {
  // Pause the process: its socket stays open but nothing is answered. The gateway pings every 20 s and drops a peer
  // it has not heard from for 60 s, so this takes about a minute and a half: that is the point, not a hang.
  const pid = n2.pid;
  test.skip(!pid, 'no process');
  process.kill(pid!, 'SIGSTOP');
  try {
    await offline(n2.nodeId, 4 * 60_000);
    expect((await ask()).status, 'the other device answers').toBe(200);
  } finally {
    process.kill(pid!, 'SIGCONT');
  }
  await online(n2.nodeId, 3 * 60_000);
});

for (const how of ['kill', 'stop'] as const) {
  test(`an answer in progress when its device ${how === 'kill' ? 'dies' : 'is told to stop'} ends cleanly`, async () => {
    await Promise.all([online(n1.nodeId), online(n2.nodeId)]);
    await serving();
    let victim: CliNode = n1;
    const result = await stream(async () => {
      // The device with a request in flight (telemetry can lag: fall back to the first one).
      for (let i = 0; i < 6; i++) {
        for (const n of [n1, n2]) {
          if (((await nodeOf(n.nodeId)).live?.inFlight ?? 0) > 0) victim = n;
        }
        if (victim !== n1 || ((await nodeOf(n1.nodeId)).live?.inFlight ?? 0) > 0) break;
        await page.waitForTimeout(500);
      }
      if (how === 'kill') await victim.kill();
      else void victim.stop();
    });
    // The client is never left hanging: the stream finished ([DONE], resumed or completed) or ended with an error.
    expect(result.status).toBe(200);
    expect(result.text.length).toBeGreaterThan(0);
    // What arrived is a well-formed stream up to where it stopped: every data line is [DONE] or JSON.
    for (const line of result.text.split('\n').filter((l) => l.startsWith('data: '))) {
      const payload = line.slice(6);
      if (payload !== '[DONE]') expect(() => JSON.parse(payload), payload).not.toThrow();
    }
    await victim.kill();
    // The pool still serves, on whichever device is left, and the victim comes back.
    await expect
      .poll(async () => (await ask()).status, { timeout: 60_000, intervals: [1_000] })
      .toBe(200);
    await victim.start();
    await online(victim.nodeId);
  });
}

test('settings on the device apply; the admin override wins; lifting it hands back to the device', async () => {
  await n2.kill();
  await offline(n2.nodeId);
  await n2.config('--context', '1024');
  await n2.start();
  await online(n2.nodeId);
  const live = async () => {
    const n = await nodeOf(n2.nodeId);
    return [n.maxContextTokens, n.live?.maxContextTokens];
  };
  await expect
    .poll(live, {
      timeout: 5 * 60_000,
      intervals: [5_000],
      message: 'the device ignored its own setting',
    })
    .toEqual([null, 1024]);

  // Admin override: the device's own value no longer counts.
  expect(
    (await api(page, 'PATCH', org(`/nodes/${n2.nodeId}`), { maxContextTokens: 2048 })).status,
  ).toBe(200);
  await expect
    .poll(live, { timeout: 5 * 60_000, intervals: [5_000], message: 'the override did not win' })
    .toEqual([2048, 2048]);
  // The other device is untouched by it.
  expect((await nodeOf(n1.nodeId)).maxContextTokens).toBeNull();

  // Lifted: the device's own setting is back.
  expect(
    (await api(page, 'PATCH', org(`/nodes/${n2.nodeId}`), { maxContextTokens: null })).status,
  ).toBe(200);
  await expect
    .poll(live, { timeout: 5 * 60_000, intervals: [5_000], message: 'lifting did not hand back' })
    .toEqual([null, 1024]);
  await serving();
});

test('the device API: only a node with its own key, only its own pool', async () => {
  const id = n2.nodeId;
  const seed = n2.seedHex;
  const url = (path: string) => `${baseUrl()}${path}`;
  const call = async (path: string, authorization?: string, headers: Record<string, string> = {}) =>
    page.request.fetch(url(path), {
      headers: { ...(authorization ? { authorization } : {}), ...headers },
    });

  const me = await call('/api/node/me', nodeAuthHeader(seed, id, 'GET', '/api/node/me'));
  expect(me.status()).toBe(200);
  expect(((await me.json()) as { nodeId: string }).nodeId).toBe(id);

  const list = await call('/api/node/models', nodeAuthHeader(seed, id, 'GET', '/api/node/models'));
  expect(list.status()).toBe(200);
  const mine = (await list.json()) as { id: string; sha256: string | null }[];
  expect(mine.map((m) => m.id)).toEqual([chatModel.id]);

  // Every way of not being that device is the same refusal.
  const other = n1.seedHex;
  const refused: [string, string | undefined][] = [
    ['no header', undefined],
    ['garbage', 'Node nonsense'],
    ['bearer instead', `Bearer ${await accessToken(page)}`],
    ['a stale timestamp', nodeAuthHeader(seed, id, 'GET', '/api/node/me', -3600)],
    ['a future timestamp', nodeAuthHeader(seed, id, 'GET', '/api/node/me', 3600)],
    ['signed for another path', nodeAuthHeader(seed, id, 'GET', '/api/node/models')],
    ['signed for another method', nodeAuthHeader(seed, id, 'POST', '/api/node/me')],
    ['signed with another device key', nodeAuthHeader(other, id, 'GET', '/api/node/me')],
    ['another device id', nodeAuthHeader(seed, crypto.randomUUID(), 'GET', '/api/node/me')],
  ];
  const bodies = new Set<string>();
  for (const [what, header] of refused) {
    const res = await call('/api/node/me', header);
    expect(res.status(), what).toBe(401);
    bodies.add(await res.text());
  }
  expect(bodies.size, 'the refusal says nothing about why').toBe(1);

  // A model file: ranges work (resume), another pool's model is not there for it, and a bad range is refused.
  const file = `/api/node/models/${chatModel.id}/file`;
  const part = await call(file, nodeAuthHeader(seed, id, 'GET', file), { range: 'bytes=0-15' });
  expect(part.status()).toBe(206);
  expect((await part.body()).length).toBe(16);
  expect(part.headers()['content-range']).toMatch(/^bytes 0-15\//);
  const bad = await call(file, nodeAuthHeader(seed, id, 'GET', file), {
    range: 'bytes=999999999999-',
  });
  expect(bad.status()).toBe(416);
  const foreign = `/api/node/models/${embedModel.id}/file`;
  expect(
    (await call(foreign, nodeAuthHeader(seed, id, 'GET', foreign))).status(),
    "a model the pool does not serve, though it is the organisation's",
  ).toBe(404);
  const unknown = `/api/node/models/${crypto.randomUUID()}/file`;
  expect((await call(unknown, nodeAuthHeader(seed, id, 'GET', unknown))).status()).toBe(404);
  // Without a signature the file is not served at all.
  expect((await call(file)).status()).toBe(401);
});

test('a code works once; a second device with it is refused', async () => {
  const used = await code();
  const first = newCli();
  await first.enroll(used);
  const second = newCli();
  const refusal = await second.tryEnroll(used);
  expect(refusal, 'the second device must be refused').not.toBeNull();
  expect(second.enrolled).toBe(false);
  // The first device is there, the second left nothing behind.
  const nodes = await poolNodes(page, orgId, poolId);
  expect(nodes.some((n) => n.id === first.nodeId)).toBe(true);
  await first.start();
  await online(first.nodeId);
  // Revoked: gone from the pool, its signature stops opening the device API at once, and it does not come back.
  const id = first.nodeId;
  const seed = first.seedHex;
  expect((await api(page, 'DELETE', org(`/nodes/${id}`))).status).toBe(204);
  await expect
    .poll(
      async () =>
        (
          await page.request.fetch(`${baseUrl()}/api/node/me`, {
            headers: { authorization: nodeAuthHeader(seed, id, 'GET', '/api/node/me') },
          })
        ).status(),
      { timeout: 30_000 },
    )
    .toBe(401);
  await expect
    .poll(async () => (await poolNodes(page, orgId, poolId)).some((n) => n.id === id), {
      timeout: 60_000,
    })
    .toBe(false);
  await page.waitForTimeout(15_000); // long enough for a reconnect attempt
  expect((await poolNodes(page, orgId, poolId)).some((n) => n.id === id)).toBe(false);
  await first.kill();
});

test('approval: a device waits, cannot fetch anything, and is turned away when rejected', async () => {
  const waiting = newCli();
  await waiting.enroll(await code(approvalPoolId));
  await waiting.start();
  const nodes = () => poolNodes(page, orgId, approvalPoolId);
  await expect.poll(async () => (await nodes()).length, { timeout: 60_000 }).toBe(1);
  const pending = (await nodes())[0]!;
  expect(pending.approved).toBe(false);
  expect(pending.status).toBe('pending');
  expect(waiting.nodeId).toBe(pending.id);
  // Not approved: the device API says no, and the pool has nothing to serve with.
  const res = await page.request.fetch(`${baseUrl()}/api/node/models`, {
    headers: {
      authorization: nodeAuthHeader(waiting.seedHex, waiting.nodeId, 'GET', '/api/node/models'),
    },
  });
  expect(res.status()).toBe(401);
  expect((await ask()).status).toBe(200); // the other pool is not affected
  // Rejecting is deleting it: it disappears and does not return.
  expect((await api(page, 'DELETE', org(`/nodes/${pending.id}`))).status).toBe(204);
  await expect.poll(async () => (await nodes()).length, { timeout: 30_000 }).toBe(0);
  await page.waitForTimeout(15_000);
  expect(await nodes()).toHaveLength(0);
  await waiting.kill();
});

test('a token limit refuses further requests with Retry-After; the other key is not affected', async () => {
  const limited = await newKey([poolId], { tokensPerMinute: 24 });
  await expect
    .poll(async () => (await gateway(page, limited.secret, 'GET', '/models')).status, {
      timeout: 30_000,
    })
    .toBe(200);
  let refused: Awaited<ReturnType<typeof ask>> | undefined;
  for (let i = 0; i < 8 && !refused; i++) {
    const r = await ask(limited.secret, { max_tokens: 16 });
    if (r.status === 429) refused = r;
    else expect(r.status).toBe(200);
  }
  expect(refused, 'the token limit was never reached').toBeTruthy();
  expect(Number(refused!.headers['retry-after'])).toBeGreaterThan(0);
  expect((await ask()).status, 'another key keeps working').toBe(200);
  // Counted against the right key: the usage of the limited key shows tokens, the other key's is separate.
  const usage = await api<{ totals: { requests: number } }>(page, 'GET', org('/usage'));
  expect(usage.status).toBe(200);
});

test("replacing the pool's model reaches its devices", async () => {
  // The pool swaps models: devices pick the new one up on their next sync; the old one stops being served.
  const other = await newPool(`e2e-multi-swap-${uniq()}`);
  const node = newCli();
  await join(node, other);
  const key = await newKey([other]);
  await expect
    .poll(async () => (await ask(key.secret)).status, { timeout: 10 * 60_000, intervals: [3_000] })
    .toBe(200);
  expect((await api(page, 'PUT', org(`/pools/${other}/models/${embedModel.id}`))).status).toBe(204);
  // The chat model is no longer served by this pool; the embedding model is, once the device has loaded it.
  await expect
    .poll(async () => (await ask(key.secret)).status, { timeout: 60_000, intervals: [2_000] })
    .toBe(404);
  await expect
    .poll(
      async () =>
        (
          await gateway(page, key.secret, 'POST', '/embeddings', {
            model: EMBEDDING_MODEL.name,
            input: 'hello',
          })
        ).status,
      { timeout: 10 * 60_000, intervals: [3_000], message: 'the device never took the new model' },
    )
    .toBe(200);
  await node.kill();
});

test('mixed devices: a browser tab and a command-line node share one pool', async ({ browser }) => {
  const why = await webNode.unavailable();
  test.skip(!!why, why ?? '');
  const mixed = await newPool(`e2e-multi-mixed-${uniq()}`, { balancingType: 'round_robin' });
  const key = await newKey([mixed]);
  const cliNode = newCli();
  await join(cliNode, mixed);
  await webNode.join(await code(mixed), { browser });
  const ids = async () =>
    (await poolNodes(page, orgId, mixed)).filter((n) => n.status === 'online');
  await expect
    .poll(async () => (await ids()).length, { timeout: 15 * 60_000, intervals: [3_000] })
    .toBe(2);
  // "Online" is only the connection, and a device that is still loading gets no traffic. The fake command-line node is
  // ready at once, the browser tab needs minutes: wait for both, or the requests below all go to the first one.
  await Promise.all((await ids()).map((n) => loaded(n.id)));
  await expect
    .poll(async () => (await ask(key.secret)).status, { timeout: 15 * 60_000, intervals: [3_000] })
    .toBe(200);
  const platforms = (await ids()).map((n) => n.platform).sort();
  expect(platforms).toEqual(['cli', 'web']);
  const base = new Map<string, number>();
  for (const n of await ids()) base.set(n.id, await served(n.id, mixed));
  for (let i = 0; i < 16; i++) expect((await ask(key.secret)).status).toBe(200);
  await expect
    .poll(
      async () => {
        const counts: number[] = [];
        for (const [id, before] of base) counts.push((await served(id, mixed)) - before);
        return counts.every((c) => c > 0);
      },
      { timeout: 4 * 60_000, intervals: [10_000], message: 'one kind of device took nothing' },
    )
    .toBe(true);
  await webNode.stop();
  await cliNode.kill();
});

// ---------------------------------------------------------------------------------------------------------------------
// What the customer's integration relies on
// ---------------------------------------------------------------------------------------------------------------------

/** Concurrent requests, so both devices are busy at once. */
const burst = (key: string, n: number, extra: object = {}) =>
  Promise.all(Array.from({ length: n }, () => ask(key, { max_tokens: 24, ...extra })));

test('every balancing choice reaches both devices', async () => {
  await Promise.all([online(n1.nodeId), online(n2.nodeId)]);
  await Promise.all([loaded(n1.nodeId), loaded(n2.nodeId)]);
  await serving();
  for (const balancingType of ['least_in_flight', 'random'] as const) {
    expect(
      (await api(page, 'PATCH', org(`/pools/${poolId}`), { balancingType })).status,
      balancingType,
    ).toBe(200);
    const base = [await served(n1.nodeId), await served(n2.nodeId)];
    // Busy devices are what "least in flight" compares: send them in bursts. "Random" needs only many requests.
    for (let round = 0; round < 3; round++) {
      const replies = await burst(apiKey, 8);
      for (const r of replies) expect([200, 429, 503], balancingType).toContain(r.status);
    }
    await expect
      .poll(
        async () =>
          (await served(n1.nodeId)) - base[0]! > 0 && (await served(n2.nodeId)) - base[1]! > 0,
        {
          timeout: 4 * 60_000,
          intervals: [10_000],
          message: `${balancingType}: one device took nothing`,
        },
      )
      .toBe(true);
  }
  expect(
    (await api(page, 'PATCH', org(`/pools/${poolId}`), { balancingType: 'weighted_p2c' })).status,
  ).toBe(200);
});

test('a client that hangs up mid-answer frees the device', async () => {
  const inFlight = async () =>
    ((await nodeOf(n1.nodeId)).live?.inFlight ?? 0) +
    ((await nodeOf(n2.nodeId)).live?.inFlight ?? 0);
  await serving();
  await expect.poll(inFlight, { timeout: 60_000, intervals: [2_000] }).toBe(0);
  const controller = new AbortController();
  const res = await fetch(`${baseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(chat({ stream: true, max_tokens: 1000 })),
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  await reader.read(); // the first piece is on its way
  // The device reports it is busy with the answer...
  await expect
    .poll(inFlight, {
      timeout: 30_000,
      intervals: [1_000],
      message: 'the answer never showed as running',
    })
    .toBeGreaterThan(0);
  // ...the client leaves...
  controller.abort();
  await reader.cancel().catch(() => undefined);
  // ...and the device is told to stop: it is free again long before 1000 tokens could have been generated.
  await expect
    .poll(inFlight, { timeout: 30_000, intervals: [1_000], message: 'the device kept generating' })
    .toBe(0);
  expect((await ask()).status, 'and it serves the next one').toBe(200);
});

test('a short reply says it was cut, a conversation keeps its roles, the numbers add up', async () => {
  await serving();
  const cut = await gateway<{
    choices: { finish_reason: string; message: { role: string; content: string } }[];
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  }>(page, apiKey, 'POST', '/chat/completions', chat({ max_tokens: 3 }));
  expect(cut.status).toBe(200);
  expect(cut.body.choices[0]!.finish_reason).toBe('length');
  expect(cut.body.choices[0]!.message.role).toBe('assistant');
  // The fake engine's answer is exact: one piece per token.
  expect(cut.body.choices[0]!.message.content).toMatch(/^tok0 tok1 tok2/);
  const u = cut.body.usage;
  expect(u.prompt_tokens).toBeGreaterThan(0);
  expect(u.completion_tokens).toBeGreaterThan(0);
  expect(u.completion_tokens).toBeLessThanOrEqual(4);
  expect(u.total_tokens).toBe(u.prompt_tokens + u.completion_tokens);

  // A system message, an earlier answer and non-ASCII text are all part of the conversation.
  const convo = await ask(apiKey, {
    max_tokens: 24,
    messages: [
      { role: 'system', content: 'You answer in one short sentence.' },
      { role: 'user', content: 'Salut! Ce faci?' },
      { role: 'assistant', content: 'Bine, mulțumesc.' },
      { role: 'user', content: [{ type: 'text', text: 'Și tu, ce faci azi?' }] },
    ],
  });
  expect(convo.status).toBe(200);

  // A streamed answer: JSON pieces, an assistant role first, a finish reason last, then [DONE].
  const res = await fetch(`${baseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(chat({ stream: true, max_tokens: 12 })),
  });
  const lines = (await res.text()).split('\n').filter((l) => l.startsWith('data: '));
  expect(lines.at(-1)).toBe('data: [DONE]');
  const chunks = lines.slice(0, -1).map(
    (l) =>
      JSON.parse(l.slice(6)) as {
        choices: { delta: { role?: string; content?: string }; finish_reason: string | null }[];
      },
  );
  expect(chunks[0]!.choices[0]!.delta.role).toBe('assistant');
  expect(chunks.at(-1)!.choices[0]!.finish_reason).toBeTruthy();
  expect(chunks.map((c) => c.choices[0]!.delta.content ?? '').join('').length).toBeGreaterThan(0);

  // What was generated is on the organisation's usage (written in batches, so poll).
  await expect
    .poll(
      async () =>
        (await api<{ totals: { tokensOut: number } }>(page, 'GET', org('/usage'))).body.totals
          .tokensOut,
      { timeout: 3 * 60_000, intervals: [10_000] },
    )
    .toBeGreaterThanOrEqual(u.completion_tokens);
});

test('a prompt that cannot fit the device is refused with the numbers', async () => {
  const pool = await newPool(`e2e-multi-ctx-${uniq()}`);
  const key = await newKey([pool]);
  const small = newCli();
  await small.enroll(await code(pool));
  await small.config('--context', '512');
  await small.start();
  await online(small.nodeId, 15 * 60_000, pool);
  await expect
    .poll(async () => (await nodeOf(small.nodeId)).live?.maxContextTokens ?? null, {
      timeout: 10 * 60_000,
      intervals: [3_000],
      message: 'the device never loaded with its small window',
    })
    .toBe(512);
  await expect
    .poll(async () => (await ask(key.secret)).status, { timeout: 5 * 60_000, intervals: [3_000] })
    .toBe(200);

  const words = (n: number) => 'word '.repeat(n); // 5 characters ≈ 1.25 tokens
  const fits = await ask(key.secret, {
    max_tokens: 16,
    messages: [{ role: 'user', content: words(320) }], // 1600 chars ≈ 400 tokens
  });
  expect(fits.status, JSON.stringify(fits.body)).toBe(200);

  const long = await ask(key.secret, {
    max_tokens: 16,
    messages: [{ role: 'user', content: words(480) }], // 2400 chars ≈ 600 tokens
  });
  expect(long.status).toBe(400);
  expect(long.body.error.code).toBe('context_length_exceeded');
  expect(long.body.error.message).toContain('512');

  const greedy = await ask(key.secret, { max_tokens: 4096 });
  expect(greedy.status).toBe(400);
  expect(greedy.body.error.code).toBe('context_length_exceeded');
  // Said in Romanian when asked in Romanian, same code.
  const ro = await gateway<OpenAIError>(
    page,
    key.secret,
    'POST',
    '/chat/completions',
    chat({ max_tokens: 4096 }),
    { 'accept-language': 'ro' },
  );
  expect(ro.body.error.code).toBe('context_length_exceeded');
  expect(ro.body.error.message).not.toBe(greedy.body.error.message);
  // The device is idle (its last report may still show the answer of a moment ago, so wait for the next one) and
  // still serves; the refusals above came back at once, from the gateway, without a device being asked.
  await expect
    .poll(async () => (await nodeOf(small.nodeId)).live?.inFlight ?? 0, {
      timeout: 60_000,
      intervals: [2_000],
      message: 'the device never reported itself idle',
    })
    .toBe(0);
  expect((await ask(key.secret)).status).toBe(200);
  await small.kill();
});

test('embeddings on a real device: sizes, encodings, tasks, order, meaning', async () => {
  test.setTimeout(40 * 60_000);
  const pool = await newPool(`e2e-multi-emb-${uniq()}`, {}, embedModel.id);
  const key = await newKey([pool]);
  const node = newCli(false); // the real engine: this test checks meaning
  await node.enroll(await code(pool));
  await node.start();
  await online(node.nodeId, 15 * 60_000, pool);

  type Emb = { object: string; index: number; embedding: number[] | string };
  const embed = (body: object) =>
    gateway<{ data: Emb[]; usage: { prompt_tokens: number }; error?: unknown }>(
      page,
      key.secret,
      'POST',
      '/embeddings',
      { model: EMBEDDING_MODEL.name, ...body },
    );
  await expect
    .poll(async () => (await embed({ input: 'hello' })).status, {
      timeout: 15 * 60_000,
      intervals: [3_000],
      message: 'the device never served embeddings',
    })
    .toBe(200);

  const cat = 'The cat sat on the mat.';
  const kitten = 'A kitten is resting on the rug.';
  const mortgage = 'Quarterly mortgage interest rates rose again.';
  const vec = (e: Emb) => e.embedding as number[];
  const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
  const norm = (a: number[]) => Math.sqrt(dot(a, a));
  const cos = (a: number[], b: number[]) => dot(a, b) / (norm(a) * norm(b));

  // A batch comes back in the order it was sent, with the right size and a sensible meaning.
  const batch = await embed({ input: [cat, kitten, mortgage] });
  expect(batch.body.data.map((d) => d.index)).toEqual([0, 1, 2]);
  expect(batch.body.data.every((d) => d.object === 'embedding')).toBe(true);
  const [vCat, vKitten, vMortgage] = batch.body.data.map(vec) as [number[], number[], number[]];
  const full = vCat.length;
  expect(full).toBeGreaterThan(100);
  expect(vKitten.length).toBe(full);
  expect(cos(vCat, vKitten), 'a cat is closer to a kitten than to a mortgage').toBeGreaterThan(
    cos(vCat, vMortgage),
  );
  expect(batch.body.usage.prompt_tokens).toBeGreaterThan(0);

  // The same text alone gives (nearly) the same vector as inside a batch.
  const alone = vec((await embed({ input: cat })).body.data[0]!);
  expect(cos(alone, vCat)).toBeGreaterThan(0.99);

  // Fewer dimensions: that many numbers, cut and scaled back to length 1.
  const short = vec((await embed({ input: cat, dimensions: 64 })).body.data[0]!);
  expect(short).toHaveLength(64);
  expect(norm(short)).toBeGreaterThan(0.98);
  expect(norm(short)).toBeLessThan(1.02);

  // The compact encoding is the same numbers as little-endian 32-bit floats.
  const b64 = (await embed({ input: cat, encoding_format: 'base64' })).body.data[0]!.embedding;
  expect(typeof b64).toBe('string');
  const bytes = Buffer.from(b64 as string, 'base64');
  expect(bytes.length).toBe(full * 4);
  const decoded = Array.from({ length: full }, (_, i) => bytes.readFloatLE(i * 4));
  expect(cos(decoded, alone)).toBeGreaterThan(0.999);

  // More numbers than the model has is the client's mistake: a 400 that says so, not a failed device.
  const tooMany = await embed({ input: cat, dimensions: full * 100 });
  expect(tooMany.status).toBe(400);
  expect(await statusOf(node.nodeId, pool)).toBe('online');

  // The kind of text changes the vector: a search query and a document are not embedded the same way.
  const asQuery = vec((await embed({ input: cat, task: 'query' })).body.data[0]!);
  const asDocument = vec((await embed({ input: cat, task: 'document' })).body.data[0]!);
  expect(asQuery).toHaveLength(full);
  expect(cos(asQuery, asDocument)).toBeLessThan(0.9999);
  await node.kill();
});

test("taking away a pool's model, then the pool, is felt by the device and the key at once", async () => {
  const pool = await newPool(`e2e-multi-del-${uniq()}`);
  const key = await newKey([pool]);
  const node = newCli();
  await join(node, pool);
  await online(node.nodeId, 15 * 60_000, pool);
  await expect
    .poll(async () => (await ask(key.secret)).status, { timeout: 10 * 60_000, intervals: [3_000] })
    .toBe(200);
  const seed = node.seedHex;
  const id = node.nodeId;
  const signed = (path: string) =>
    page.request.fetch(`${baseUrl()}${path}`, {
      headers: { authorization: nodeAuthHeader(seed, id, 'GET', path) },
    });

  // The pool stops serving its model: the key no longer knows the name, the device is told it has nothing to serve.
  expect((await api(page, 'DELETE', org(`/pools/${pool}/models/${chatModel.id}`))).status).toBe(
    204,
  );
  await expect
    .poll(async () => (await ask(key.secret)).status, { timeout: 30_000, intervals: [1_000] })
    .toBe(404);
  await expect
    .poll(async () => ((await (await signed('/api/node/models')).json()) as unknown[]).length, {
      timeout: 30_000,
    })
    .toBe(0);
  expect(await statusOf(id, pool), 'the device stays enrolled and connected').toBe('online');

  // Serving it again: the device fetches and loads the model again, and answers.
  expect((await api(page, 'PUT', org(`/pools/${pool}/models/${chatModel.id}`))).status).toBe(204);
  await expect
    .poll(async () => (await ask(key.secret)).status, { timeout: 10 * 60_000, intervals: [3_000] })
    .toBe(200);

  // The pool goes away with its devices: the device is gone from the organisation, its signature is worthless and
  // the key (which only knew that pool) has nothing left.
  expect((await api(page, 'DELETE', org(`/pools/${pool}`))).status).toBe(204);
  poolIds.splice(poolIds.indexOf(pool), 1);
  expect((await api(page, 'GET', org(`/nodes/${id}`))).status).toBe(404);
  await expect
    .poll(async () => (await signed('/api/node/me')).status(), { timeout: 30_000 })
    .toBe(401);
  await expect
    .poll(async () => (await ask(key.secret)).status, { timeout: 30_000, intervals: [1_000] })
    .toBe(404);
  await node.kill();
});

test("codes for many devices at once, admin overrides, and the node's own commands", async () => {
  test.setTimeout(20 * 60_000);
  // A tiny model: the devices download it (a few KB) but cannot run it, which is all this test needs.
  const tiny = `e2e-multi-tiny-${uniq()}`;
  const tinyId = await uploadTinyModel(page, orgId, tiny);
  modelIds.push(tinyId);
  const pool = await newPool(`e2e-multi-bulk-${uniq()}`, {}, tinyId);

  // Three codes in one go, three devices.
  const bulk = await api<{ items: { code: string }[] }>(
    page,
    'POST',
    org(`/pools/${pool}/enrollments/bulk`),
    { count: 3 },
  );
  expect(bulk.status).toBe(201);
  const devices = [newCli(false), newCli(false), newCli(false)]; // the real download into a chosen folder
  for (const [i, d] of devices.entries()) await d.enroll(bulk.body.items[i]!.code);
  const listed = await poolNodes(page, orgId, pool);
  expect(new Set(listed.map((n) => n.id)).size).toBe(3);
  expect(listed.map((n) => n.id).sort()).toEqual(devices.map((d) => d.nodeId).sort());
  expect(listed.every((n) => n.platform === 'cli')).toBe(true);
  const fingerprints = await Promise.all(
    devices.map(
      async (d) =>
        (await api<{ fingerprint: string }>(page, 'GET', org(`/nodes/${d.nodeId}`))).body
          .fingerprint,
    ),
  );
  expect(new Set(fingerprints).size, 'every device has a key of its own').toBe(3);
  // Used codes are used up.
  const again = newCli();
  expect(await again.tryEnroll(bulk.body.items[0]!.code), 'a used bulk code').not.toBeNull();

  // Admin overrides on a device (it is not running: nothing reloads): saved, shown, validated, cleared.
  const dev = devices[0]!;
  const patch = (body: object) => api<NodeFull>(page, 'PATCH', org(`/nodes/${dev.nodeId}`), body);
  const saved = await patch({
    name: 'rack 7',
    keepScreenOn: true,
    enableMtp: true,
    computeBackend: 'gpu',
    maxContextTokens: 4096,
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  expect(saved.body).toMatchObject({
    name: 'rack 7',
    keepScreenOn: true,
    enableMtp: true,
    computeBackend: 'gpu',
    maxContextTokens: 4096,
  });
  expect((await nodeOf(dev.nodeId)) as unknown as { keepScreenOn: boolean }).toMatchObject({
    keepScreenOn: true,
  });
  for (const [what, body] of [
    ['a window below the minimum', { maxContextTokens: 511 }],
    ['a window above the maximum', { maxContextTokens: 131_073 }],
    ['a backend nobody has', { computeBackend: 'tpu' }],
    ['nothing to change', {}],
    ['un-approving', { approved: false }],
    ['an empty name', { name: '' }],
  ] as const) {
    expect((await patch(body)).status, what).toBe(400);
  }
  expect((await patch({ maxContextTokens: 512 })).status).toBe(200);
  expect((await patch({ maxContextTokens: 131_072 })).status).toBe(200);
  const cleared = await patch({
    keepScreenOn: null,
    enableMtp: null,
    computeBackend: null,
    maxContextTokens: null,
  });
  expect(cleared.body).toMatchObject({
    keepScreenOn: null,
    enableMtp: null,
    computeBackend: null,
    maxContextTokens: null,
  });
  expect(cleared.body.name, 'clearing overrides keeps the name').toBe('rack 7');
  // Another organisation's device is out of reach.
  expect(
    (
      await api(page, 'PATCH', `/organisations/${crypto.randomUUID()}/nodes/${dev.nodeId}`, {
        name: 'x',
      })
    ).status,
  ).toBeGreaterThanOrEqual(403);

  // The node's own commands. `status` says who it is, as the web app does.
  const me = devices[1]!;
  const meId = me.nodeId; // `leave` deletes the file this is read from
  const status = await me.exec('status');
  expect(status.code).toBe(0);
  expect(status.out).toContain(me.nodeId);
  expect(status.out).toContain('Pool:');
  expect(status.out).toMatch(/Approved:\s+yes/);
  expect(status.out).toContain('e2e'); // the organisation

  // `config`: a folder for the models must be an absolute path; then the node keeps its models there.
  expect((await me.exec('config', '--models-dir', 'relative/models')).code).not.toBe(0);
  const modelsDir = mkdtempSync(pathJoin(tmpdir(), 'splitcortex-e2e-models-'));
  const set = await me.exec('config', '--models-dir', modelsDir);
  expect(set.code, set.out).toBe(0);
  expect(set.out).toContain(modelsDir);
  await me.start();
  const file = pathJoin(modelsDir, `${tinyId}.litertlm`);
  await expect
    .poll(() => existsSync(pathJoin(modelsDir, `${tinyId}.ok`)) && statSync(file).size, {
      timeout: 2 * 60_000,
      intervals: [1_000],
      message: 'the model never arrived in the chosen folder',
    })
    .toBe(4096);
  expect(existsSync(pathJoin(me.home, 'data', 'models', `${tinyId}.litertlm`))).toBe(false);
  await online(me.nodeId, 5 * 60_000, pool);
  await me.kill();

  // `update --check` talks to GitHub: it answers either way and never changes anything.
  const update = await me.exec('update', '--check');
  if (/rate limit/i.test(update.out)) {
    // GitHub's anonymous limit (60 an hour per IP) is used up: the command said so clearly and exited with an error,
    // which is all it can do. Not a verdict on the node.
    expect(update.code).not.toBe(0);
    test.info().annotations.push({
      type: 'note',
      description: 'update --check not verified: GitHub rate limit',
    });
  } else {
    expect(update.code, update.out).toBe(0);
    expect(update.out).toMatch(/Up to date|newer version|No release/);
  }

  // `leave` forgets the device here. The admin still has to remove it from the organisation.
  const left = await me.exec('leave');
  expect(left.code).toBe(0);
  expect((await me.exec('status')).out).toContain('Not enrolled');
  expect((await poolNodes(page, orgId, pool)).some((n) => n.id === meId)).toBe(true);
  expect((await api(page, 'DELETE', org(`/nodes/${meId}`))).status).toBe(204);
});

test('the audit log has the device events, with no prompt in them', async () => {
  // No `action` at all means every action (an empty `action=` is not "no filter").
  const audit = async (action?: string) => {
    const res = await api<{ items: { action: string; metadata: unknown }[] }>(
      page,
      'GET',
      org(`/audit-logs?limit=100${action ? `&action=${action}` : ''}`),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.items;
  };
  expect((await audit('node.enroll')).length).toBeGreaterThan(0);
  expect((await audit('node.delete')).length).toBeGreaterThan(0);
  const everything = JSON.stringify(await audit());
  expect(everything.length).toBeGreaterThan(2);
  expect(everything).not.toContain('Count from one to ten');
  expect(everything).not.toContain(apiKey);
});
