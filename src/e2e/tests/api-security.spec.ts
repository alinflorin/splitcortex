import { expect, test, type Page } from '@playwright/test';
import {
  api,
  createOrg,
  deleteOrg,
  gateway,
  uniq,
  uploadTinyModel,
  userPage,
  type OpenAIError,
} from '../lib/api';
import { baseUrl, CHAT_MODEL, EMBEDDING_MODEL, optional, users } from '../lib/env';
import { loadState } from '../lib/state';

// What can go wrong without a device: enrollment guessing, keys reaching beyond their pools or organisation, the model
// life cycle (bad Hugging Face links, retry, replacing and deleting a served model) and the audit log not growing per
// request. Throw-away organisations and pools; the e2e organisation is only read (its models are reused).

interface Named {
  id: string;
  name: string;
  status?: string;
  error?: string | null;
}
interface Created {
  key: { id: string };
  secret: string;
}
interface ModelList {
  data: { id: string }[];
}
interface Enrollment {
  id: string;
  attempts: number;
  maxAttempts: number;
}
interface AuditPage {
  items: { action: string; source: string; actorId: string | null }[];
}

let a: Page; // user 1
let b: Page; // user 1, a second organisation
let orgA: { id: string };
let orgB: { id: string };
let sharedOrg: string; // the e2e organisation (read only)
let sharedChat: Named;
let sharedEmbed: Named;
const poolsA: Record<'p1' | 'p2' | 'p3', string> = { p1: '', p2: '', p3: '' };

const A = (path = '') => `/organisations/${orgA.id}${path}`;
const B = (path = '') => `/organisations/${orgB.id}${path}`;
const chat = (model: string) => ({
  model,
  messages: [{ role: 'user', content: 'hi' }],
  max_tokens: 4,
});

async function newKey(page: Page, org: string, body: object): Promise<Created> {
  const res = await api<Created>(page, 'POST', `/organisations/${org}/api-keys`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await expect
    .poll(async () => (await gateway(page, res.body.secret, 'GET', '/models')).status, {
      timeout: 30_000,
      intervals: [500, 1000],
      message: 'the gateway never accepted the key',
    })
    .toBe(200);
  return res.body;
}

async function newPool(page: Page, org: string, name: string): Promise<string> {
  const res = await api<{ id: string }>(page, 'POST', `/organisations/${org}/pools`, { name });
  expect(res.status).toBe(201);
  return res.body.id;
}

test.beforeAll(async ({ browser }) => {
  const state = loadState();
  sharedOrg = state.orgId;
  a = await userPage(browser, 0);
  b = await userPage(browser, 0);
  orgA = await createOrg(a, 'sec-a');
  orgB = await createOrg(b, 'sec-b');
  const models = (await api<Named[]>(a, 'GET', `/organisations/${sharedOrg}/models`)).body;
  sharedChat = models.find((m) => m.name === CHAT_MODEL.name)!;
  sharedEmbed = models.find((m) => m.name === EMBEDDING_MODEL.name)!;
  expect(sharedChat && sharedEmbed, 'the e2e models exist (setup)').toBeTruthy();
  for (const k of ['p1', 'p2', 'p3'] as const) poolsA[k] = await newPool(a, orgA.id, `sec-${k}`);
});

test.afterAll(async () => {
  await deleteOrg(a, orgA.id);
  await deleteOrg(b, orgB.id);
  await a.context().close();
  await b.context().close();
});

// ---------------------------------------------------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------------------------------------------------

test.describe('enrollment codes', () => {
  const b64 = (n: number, fill = 7) => Buffer.alloc(n, fill).toString('base64url');
  const start = (page: Page, lookupId: string) =>
    page.request.fetch(`${baseUrl()}/api/enroll/start`, {
      method: 'POST',
      data: { lookupId, sid: b64(16), share: b64(32) },
    });

  test('a code allows 3 guesses, then it is dead, the answer stays generic', async () => {
    const issued = await api<{ code: string; enrollment: Enrollment }>(
      a,
      'POST',
      A(`/pools/${poolsA.p1}/enrollments`),
    );
    expect(issued.status).toBe(201);
    const lookupId = issued.body.code.slice(0, 4);
    const attempts = async () =>
      (await api<Enrollment[]>(a, 'GET', A(`/pools/${poolsA.p1}/enrollments`))).body.find(
        (e) => e.id === issued.body.enrollment.id,
      )?.attempts;

    expect(await attempts()).toBe(0);
    for (let i = 1; i <= 3; i++) {
      const res = await start(a, lookupId);
      // A made-up share is not a valid group element, so the round never succeeds, but each one costs an attempt.
      expect([200, 404], `guess ${i}`).toContain(res.status());
      expect(await attempts(), `after guess ${i}`).toBe(i);
    }
    const fourth = await start(a, lookupId);
    expect(fourth.status()).toBe(404);
    expect(((await fourth.json()) as { message: string }).message).toBe('Invalid or expired code');
    expect(await attempts(), 'a dead code does not count further').toBe(3);

    // Same answer as for a code that never existed: nothing tells the two apart.
    const unknown = await start(a, 'ZZZZ');
    expect(unknown.status()).toBe(404);
    expect(await fourth.text()).toBe(await unknown.text());
  });

  test('a cancelled code is dead at once, also for the second round', async () => {
    const issued = await api<{ code: string; enrollment: Enrollment }>(
      a,
      'POST',
      A(`/pools/${poolsA.p1}/enrollments`),
    );
    const lookupId = issued.body.code.slice(0, 4);
    expect((await api(a, 'DELETE', A(`/enrollments/${issued.body.enrollment.id}`))).status).toBe(
      204,
    );
    expect((await start(a, lookupId)).status()).toBe(404);
    const complete = await a.request.fetch(`${baseUrl()}/api/enroll/complete`, {
      method: 'POST',
      data: { lookupId, sealed: b64(64) },
    });
    expect(complete.status()).toBe(404);
  });

  test('a second round without a first round is refused, and burns nothing it should not', async () => {
    const issued = await api<{ code: string; enrollment: Enrollment }>(
      a,
      'POST',
      A(`/pools/${poolsA.p1}/enrollments`),
    );
    const complete = await a.request.fetch(`${baseUrl()}/api/enroll/complete`, {
      method: 'POST',
      data: { lookupId: issued.body.code.slice(0, 4), sealed: b64(64, 9) },
    });
    // Nothing sealed with a PAKE key: refused as generically as an unknown code.
    expect(complete.status()).toBe(404);
    expect(((await complete.json()) as { message: string }).message).toBe(
      'Invalid or expired code',
    );
    // No node came out of it.
    expect((await api<unknown[]>(a, 'GET', A(`/pools/${poolsA.p1}/nodes`))).body).toHaveLength(0);
  });

  test('a code of one organisation cannot be listed or cancelled from another', async () => {
    const issued = await api<{ code: string; enrollment: Enrollment }>(
      a,
      'POST',
      A(`/pools/${poolsA.p1}/enrollments`),
    );
    // The list is filtered by organisation as well as pool: another organisation's pool simply has nothing to show.
    const foreign = await api<Enrollment[]>(b, 'GET', B(`/pools/${poolsA.p1}/enrollments`));
    expect(foreign.status, 'pool of another organisation').toBe(200);
    expect(foreign.body).toEqual([]);
    expect(
      (await api(b, 'DELETE', B(`/enrollments/${issued.body.enrollment.id}`))).status,
      'cancel through another organisation',
    ).toBe(404);
    const still = (await api<Enrollment[]>(a, 'GET', A(`/pools/${poolsA.p1}/enrollments`))).body;
    expect(still.map((e) => e.id)).toContain(issued.body.enrollment.id);
  });

  // 30 calls a minute per IP on the device endpoints. The node specs enroll from the same IP at the same time, so this
  // would make them fail for a minute: only on request (E2E_RATE_LIMIT=1), ideally on its own run.
  test('the device endpoints limit calls per IP', async () => {
    test.skip(
      !optional('E2E_RATE_LIMIT'),
      'set E2E_RATE_LIMIT=1 (it blocks other enrollments for a minute)',
    );
    let limited = 0;
    for (let i = 0; i < 40; i++) {
      if ((await start(a, 'ZZZZ')).status() === 429) limited++;
    }
    expect(limited, 'calls beyond the limit').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Keys and tenancy at the gateway
// ---------------------------------------------------------------------------------------------------------------------

test.describe('what a key can reach', () => {
  // The steps share the pools, models and keys made by the first one.
  test.describe.configure({ mode: 'serial' });
  const modelOf: Record<string, string> = {};
  let keyP1P2: Created;
  let keyAll: Created;
  let keyB: Created;

  test('three pools with three models; a key for two sees only those', async () => {
    // The e2e organisation's models can't be used from another organisation, so organisation A gets its own.
    for (const [k, kind] of [
      ['p1', 'chat'],
      ['p2', 'chat'],
      ['p3', 'embedding'],
    ] as const) {
      const name = `sec-m-${k}-${uniq()}`;
      const id = await uploadTinyModel(a, orgA.id, name, kind);
      modelOf[k] = name;
      const set = await api(a, 'PUT', A(`/pools/${poolsA[k]}/models/${id}`));
      expect(set.status, `serve ${k}`).toBe(204);
    }
    keyP1P2 = await newKey(a, orgA.id, {
      name: `sec-p12-${uniq()}`,
      scope: 'pools',
      poolIds: [poolsA.p1, poolsA.p2],
    });
    keyAll = await newKey(a, orgA.id, { name: `sec-all-${uniq()}`, scope: 'org' });
    keyB = await newKey(b, orgB.id, { name: `sec-b-${uniq()}`, scope: 'org' });

    const seen = (await gateway<ModelList>(a, keyP1P2.secret, 'GET', '/models')).body.data.map(
      (m) => m.id,
    );
    expect(seen.sort()).toEqual([modelOf.p1!, modelOf.p2!].sort());
    const all = (await gateway<ModelList>(a, keyAll.secret, 'GET', '/models')).body.data.map(
      (m) => m.id,
    );
    expect(all).toContain(modelOf.p3);
  });

  test('a key cannot use a pool it was not given: 404, not 503', async () => {
    // p1 and p2 exist and have no device: a key that may use them is told "no node" (503); p3 is simply unknown to it.
    const own = await gateway<OpenAIError>(
      a,
      keyP1P2.secret,
      'POST',
      '/chat/completions',
      chat(modelOf.p1!),
    );
    expect(own.status).toBe(503);
    const other = await gateway<OpenAIError>(a, keyP1P2.secret, 'POST', '/embeddings', {
      model: modelOf.p3,
      input: 'hi',
    });
    expect(other.status).toBe(404);
    expect(other.body.error.code).toBe('model_not_found');
    // The same holds when the key is narrowed afterwards.
    const narrowed = await api(a, 'PATCH', A(`/api-keys/${keyP1P2.key.id}`), {
      poolIds: [poolsA.p1],
    });
    if (narrowed.status === 200) {
      await expect
        .poll(
          async () =>
            (await gateway(a, keyP1P2.secret, 'POST', '/chat/completions', chat(modelOf.p2!)))
              .status,
          { timeout: 30_000, intervals: [500, 1000] },
        )
        .toBe(404);
    }
  });

  test('a key of another organisation sees none of it', async () => {
    const models = await gateway<ModelList>(b, keyB.secret, 'GET', '/models');
    expect(models.body.data).toEqual([]);
    for (const model of [modelOf.p1!, CHAT_MODEL.name]) {
      const res = await gateway<OpenAIError>(
        b,
        keyB.secret,
        'POST',
        '/chat/completions',
        chat(model),
      );
      expect(res.status, model).toBe(404);
      expect(res.body.error.code).toBe('model_not_found');
    }
    // Nor does the control plane let that user's other organisation near A's keys and pools.
    expect((await api(b, 'GET', B(`/pools/${poolsA.p1}/nodes`))).status).toBe(404);
    expect((await api(b, 'DELETE', B(`/api-keys/${keyAll.key.id}`))).status).toBe(404);
    expect(
      (await api(b, 'PUT', B(`/pools/${poolsA.p1}/models/${crypto.randomUUID()}`))).status,
    ).toBe(404);
  });

  test('the same model name in two organisations stays apart', async () => {
    const shared = `sec-same-${uniq()}`;
    const idA = await uploadTinyModel(a, orgA.id, shared);
    const idB = await uploadTinyModel(b, orgB.id, shared);
    expect((await api(a, 'PUT', A(`/pools/${poolsA.p1}/models/${idA}`))).status).toBe(204);
    const poolB = await newPool(b, orgB.id, 'sec-same');
    expect((await api(b, 'PUT', B(`/pools/${poolB}/models/${idB}`))).status).toBe(204);
    // A's pool serves a model B's pool also calls "shared": a pool of A cannot be given B's model, nor the reverse.
    expect((await api(a, 'PUT', A(`/pools/${poolsA.p2}/models/${idB}`))).status).toBe(404);
    expect((await api(b, 'PUT', B(`/pools/${poolB}/models/${idA}`))).status).toBe(404);
    const seenB = (await gateway<ModelList>(b, keyB.secret, 'GET', '/models')).body.data.map(
      (m) => m.id,
    );
    await expect
      .poll(
        async () =>
          (await gateway<ModelList>(b, keyB.secret, 'GET', '/models')).body.data.map((m) => m.id),
        { timeout: 30_000, intervals: [500, 1000] },
      )
      .toEqual([shared]);
    expect(seenB).not.toContain(modelOf.p1);
    // Both ask for the same name and get their own pool's answer: "no node" in each, never a cross-over.
    for (const [page, key] of [
      [a, keyAll],
      [b, keyB],
    ] as const) {
      const res = await gateway<OpenAIError>(
        page,
        key.secret,
        'POST',
        '/chat/completions',
        chat(shared),
      );
      expect(res.status).toBe(503);
    }
  });

  test('usage and metrics are scoped to the organisation asked for', async () => {
    const mine = await api<{ totals: { requests: number } }>(a, 'GET', A('/usage'));
    expect(mine.status).toBe(200);
    // Organisation B's pools and keys are not in A's numbers, and A's id is not accepted for B's pool.
    expect(
      (await api(a, 'GET', `${A('/metrics')}?poolId=${crypto.randomUUID()}`)).status,
      'unknown pool',
    ).toBeLessThan(500);
    const crossPool = await api(b, 'GET', `${B('/metrics')}?poolId=${poolsA.p1}`);
    if (crossPool.status === 200) {
      const body = crossPool.body as { pools: unknown[]; nodes: unknown[] };
      expect(body.pools).toHaveLength(0);
      expect(body.nodes).toHaveLength(0);
    } else {
      expect([400, 404]).toContain(crossPool.status);
    }
  });

  test('deleting the organisation stops its keys at once', async () => {
    const org = await createOrg(a, 'sec-gone');
    const key = await newKey(a, org.id, { name: `sec-gone-${uniq()}`, scope: 'org' });
    expect((await gateway(a, key.secret, 'GET', '/models')).status).toBe(200);
    await deleteOrg(a, org.id);
    await expect
      .poll(async () => (await gateway(a, key.secret, 'GET', '/models')).status, {
        timeout: 30_000,
        intervals: [500, 1000],
        message: 'a key of a deleted organisation still works',
      })
      .toBe(401);
  });

  test('requests do not write one audit row each', async () => {
    test.setTimeout(4 * 60_000);
    const key = await newKey(a, orgA.id, { name: `sec-audit-${uniq()}`, scope: 'org' });
    const rows = async (action?: string) =>
      (
        await api<AuditPage>(
          a,
          'GET',
          `${A('/audit-logs')}?limit=100&source=gateway${action ? `&action=${action}` : ''}`,
        )
      ).body.items;
    const before = (await rows()).length;
    // 40 requests that all end in the same "no node" refusal, plus 40 with a revoked key.
    for (let i = 0; i < 40; i++) {
      await gateway(a, key.secret, 'POST', '/chat/completions', chat(modelOf.p1!));
    }
    expect((await api(a, 'DELETE', A(`/api-keys/${key.key.id}`))).status).toBe(204);
    await expect
      .poll(async () => (await gateway(a, key.secret, 'GET', '/models')).status, {
        timeout: 30_000,
      })
      .toBe(401);
    for (let i = 0; i < 40; i++) await gateway(a, key.secret, 'GET', '/models');
    // Wait until the rejection shows up (batched), then count what 80 requests left behind.
    await expect
      .poll(async () => (await rows('api_key.rejected')).some((r) => r.actorId === key.key.id), {
        timeout: 3 * 60_000,
        intervals: [5_000],
      })
      .toBe(true);
    const mine = (await rows()).filter((r) => r.actorId === key.key.id);
    expect(mine.length, 'repeats fold into a few rows').toBeLessThan(5);
    expect((await rows()).length - before).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------------------------------------------------

test.describe('model life cycle', () => {
  test('only Hugging Face .litertlm links are accepted', async () => {
    for (const url of [
      'https://example.com/m.litertlm',
      'http://huggingface.co/acme/m/resolve/main/m.litertlm',
      'https://huggingface.co.evil.example/acme/m/resolve/main/m.litertlm',
      'https://huggingface.co/acme/m/resolve/main/m.gguf',
      'not a url',
    ]) {
      const res = await api(a, 'POST', A('/models/from-url'), { name: `bad-${uniq()}`, url });
      expect(res.status, url).toBe(400);
    }
    expect(
      (await api<Named[]>(a, 'GET', A('/models'))).body.filter((m) => m.name.startsWith('bad-')),
    ).toHaveLength(0);
  });

  test('a link to nothing ends as failed, with a reason; retry tries again', async () => {
    test.setTimeout(5 * 60_000);
    const name = `sec-missing-${uniq()}`;
    const url = `https://huggingface.co/splitcortex-e2e/does-not-exist-${uniq()}/resolve/main/none.litertlm`;
    const add = await api<Named>(a, 'POST', A('/models/from-url'), { name, url });
    expect(add.status).toBe(201);
    const status = async () =>
      (await api<Named[]>(a, 'GET', A('/models'))).body.find((m) => m.id === add.body.id);
    await expect
      .poll(async () => (await status())?.status, { timeout: 2 * 60_000, intervals: [2_000] })
      .toBe('failed');
    expect((await status())?.error, 'the reason is shown').toBeTruthy();

    // A failed model cannot be served.
    expect((await api(a, 'PUT', A(`/pools/${poolsA.p1}/models/${add.body.id}`))).status).toBe(409);
    // Retry goes back to work and fails again for the same reason; nothing else changes.
    const retry = await api(a, 'POST', A(`/models/${add.body.id}/retry`));
    expect(retry.status).toBeLessThan(300);
    await expect
      .poll(async () => (await status())?.status, { timeout: 2 * 60_000, intervals: [2_000] })
      .toBe('failed');
    // Retrying what is not failed is refused.
    const ok = await uploadTinyModel(a, orgA.id, `sec-ok-${uniq()}`);
    expect((await api(a, 'POST', A(`/models/${ok}/retry`))).status).toBe(409);
    expect((await api(a, 'DELETE', A(`/models/${add.body.id}`))).status).toBe(204);
  });

  test('replacing the served model changes what the key sees; deleting it removes it', async () => {
    const pool = await newPool(a, orgA.id, `sec-swap-${uniq()}`);
    const first = `sec-first-${uniq()}`;
    const second = `sec-second-${uniq()}`;
    const idFirst = await uploadTinyModel(a, orgA.id, first);
    const idSecond = await uploadTinyModel(a, orgA.id, second, 'embedding');
    const key = await newKey(a, orgA.id, {
      name: `sec-swap-${uniq()}`,
      scope: 'pools',
      poolIds: [pool],
    });
    const seen = async () =>
      (await gateway<ModelList>(a, key.secret, 'GET', '/models')).body.data.map((m) => m.id);

    expect((await api(a, 'PUT', A(`/pools/${pool}/models/${idFirst}`))).status).toBe(204);
    await expect.poll(seen, { timeout: 30_000, intervals: [500, 1000] }).toEqual([first]);
    // One model per pool: the second replaces the first.
    expect((await api(a, 'PUT', A(`/pools/${pool}/models/${idSecond}`))).status).toBe(204);
    await expect.poll(seen, { timeout: 30_000, intervals: [500, 1000] }).toEqual([second]);
    const served = (await api<Named[]>(a, 'GET', A(`/pools/${pool}/models`))).body;
    expect(served.map((m) => m.name)).toEqual([second]);
    // The old model is still there, just not served; the same call twice changes nothing.
    expect((await api(a, 'PUT', A(`/pools/${pool}/models/${idSecond}`))).status).toBe(204);
    // Deleting the served model takes it off the pool and out of the list at once.
    expect((await api(a, 'DELETE', A(`/models/${idSecond}`))).status).toBe(204);
    await expect.poll(seen, { timeout: 30_000, intervals: [500, 1000] }).toEqual([]);
    expect((await api<Named[]>(a, 'GET', A(`/pools/${pool}/models`))).body).toEqual([]);
    const gone = await gateway<OpenAIError>(a, key.secret, 'POST', '/embeddings', {
      model: second,
      input: 'hi',
    });
    expect(gone.status).toBe(404);
  });

  test('the pool decides what a model answers: chat on /chat, embeddings on /embeddings', async () => {
    // Setup's shared models, read only: a key for the whole e2e organisation names both kinds correctly.
    const key = await api<Created>(a, 'POST', `/organisations/${sharedOrg}/api-keys`, {
      name: `sec-kind-${uniq()}`,
      scope: 'org',
    });
    expect(key.status).toBe(201);
    try {
      await expect
        .poll(async () => (await gateway(a, key.body.secret, 'GET', '/models')).status, {
          timeout: 30_000,
        })
        .toBe(200);
      const kinds = Object.fromEntries(
        (
          await gateway<{ data: { id: string; kind: string }[] }>(
            a,
            key.body.secret,
            'GET',
            '/models',
          )
        ).body.data.map((m) => [m.id, m.kind]),
      );
      expect(kinds[sharedChat.name]).toBe('chat');
      expect(kinds[sharedEmbed.name]).toBe('embedding');
      // Not a single request here may reach a device of the node specs: both are refused before routing.
      const wrongA = await gateway(a, key.body.secret, 'POST', '/embeddings', {
        model: sharedChat.name,
        input: 'hi',
      });
      const wrongB = await gateway(
        a,
        key.body.secret,
        'POST',
        '/chat/completions',
        chat(sharedEmbed.name),
      );
      expect([wrongA.status, wrongB.status]).toEqual([400, 400]);
    } finally {
      await api(a, 'DELETE', `/organisations/${sharedOrg}/api-keys/${key.body.key.id}`);
    }
  });
});

test('a second user is not an owner of these organisations', async ({ browser }) => {
  test.skip(users().length < 2, 'needs a second E2E user');
  const other = await userPage(browser, 1);
  try {
    for (const path of [A(), A('/pools'), A('/api-keys'), A('/models'), A('/audit-logs')]) {
      expect([403, 404], path).toContain((await api(other, 'GET', path)).status);
    }
    expect(
      (await api(other, 'POST', A('/pools'), { name: 'intruder' })).status,
    ).toBeGreaterThanOrEqual(403);
    expect(
      (await api(other, 'POST', A(`/pools/${poolsA.p1}/enrollments`))).status,
      'cannot issue codes',
    ).toBeGreaterThanOrEqual(403);
  } finally {
    await other.context().close();
  }
});
