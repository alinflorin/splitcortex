import { expect, test, type Page } from '@playwright/test';
import { api, gateway, uniq, type OpenAIError } from '../lib/api';
import { authFile, baseUrl, CHAT_MODEL, EMBEDDING_MODEL } from '../lib/env';
import { loadState, type RunState } from '../lib/state';

// API keys and the OpenAI edge of the gateway, without any device: authentication, scoping, wrong-endpoint and
// unknown-model errors, "no node" (a throw-away pool that serves the chat model but has no device), rate limits,
// revocation, language of the errors and the audit trail of all that. Keys are scoped to the throw-away pool, so the
// node specs (which use the real pools) are never touched.
test.describe.configure({ mode: 'serial' });

interface Key {
  id: string;
  prefix: string;
  allPools: boolean;
  poolIds: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  limits: {
    requestsPerMinute: number | null;
    tokensPerMinute: number | null;
    tokensPerDay: number | null;
  };
}
interface Created {
  key: Key;
  secret: string;
}
interface Named {
  id: string;
  name: string;
}
interface ModelList {
  object: string;
  data: { id: string; kind: string; object: string }[];
}
interface AuditPage {
  items: {
    source: string;
    action: string;
    actorType: string;
    actorId: string | null;
    outcome: string;
    metadata: Record<string, unknown> | null;
  }[];
}

let page: Page;
let s: RunState;
let org: string;
let poolId: string;
const secrets: string[] = [];
const keyIds: string[] = [];
let scoped: Created;
let revoked: Created;
let limited: Created;

const chat = (model: string, extra: object = {}) => ({
  model,
  messages: [{ role: 'user', content: 'hi' }],
  max_tokens: 4,
  ...extra,
});

async function createKey(body: object): Promise<Created> {
  const res = await api<Created>(page, 'POST', `/organisations/${org}/api-keys`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  secrets.push(res.body.secret);
  keyIds.push(res.body.key.id);
  return res.body;
}

/** The gateway learns about a new/changed key through a change feed: wait until it knows the key. */
async function waitKnown(secret: string) {
  await expect
    .poll(async () => (await gateway(page, secret, 'GET', '/models')).status, {
      timeout: 30_000,
      intervals: [500, 1000],
      message: 'the gateway never accepted the key',
    })
    .toBe(200);
}

test.beforeAll(async ({ browser }) => {
  s = loadState();
  org = s.orgId;
  const context = await browser.newContext({ storageState: authFile(0) });
  page = await context.newPage();
  await page.goto(baseUrl());

  const models = (await api<Named[]>(page, 'GET', `/organisations/${org}/models`)).body;
  const chatModel = models.find((m) => m.name === CHAT_MODEL.name);
  expect(chatModel, 'the chat model exists (setup)').toBeTruthy();
  const pool = await api<{ id: string }>(page, 'POST', `/organisations/${org}/pools`, {
    name: `e2e-gw-${uniq()}`,
  });
  expect(pool.status).toBe(201);
  poolId = pool.body.id;
  const assign = await api(
    page,
    'PUT',
    `/organisations/${org}/pools/${poolId}/models/${chatModel!.id}`,
  );
  expect(assign.status).toBe(204);
});

test.afterAll(async () => {
  for (const id of keyIds) await api(page, 'DELETE', `/organisations/${org}/api-keys/${id}`);
  await api(page, 'DELETE', `/organisations/${org}/pools/${poolId}`);
  await page.context().close();
});

test('a new key shows its secret once and is validated', async () => {
  scoped = await createKey({ name: `e2e-scoped-${uniq()}`, scope: 'pools', poolIds: [poolId] });
  expect(scoped.secret.length).toBeGreaterThan(16);
  expect(scoped.secret.startsWith(scoped.key.prefix)).toBe(true);
  expect(scoped.key.allPools).toBe(false);
  expect(scoped.key.poolIds).toEqual([poolId]);
  expect(scoped.key.revokedAt).toBeNull();

  // Listing never returns the secret, only the readable prefix.
  const list = await api<Key[]>(page, 'GET', `/organisations/${org}/api-keys`);
  expect(list.status).toBe(200);
  expect(list.body.map((k) => k.id)).toContain(scoped.key.id);
  for (const secret of secrets) expect(JSON.stringify(list.body)).not.toContain(secret);

  const base = `/organisations/${org}/api-keys`;
  expect((await api(page, 'POST', base, { name: 'x', scope: 'pools', poolIds: [] })).status).toBe(
    400,
  );
  expect((await api(page, 'POST', base, { name: '  ', scope: 'org' })).status).toBe(400);
  expect(
    (await api(page, 'POST', base, { name: 'x', scope: 'pools', poolIds: [crypto.randomUUID()] }))
      .status,
  ).toBe(400);
  expect(
    (
      await api(page, 'POST', base, {
        name: 'x',
        scope: 'org',
        expiresAt: '2020-01-01T00:00:00.000Z',
      })
    ).status,
  ).toBe(400);
});

test('expiry and limits can be changed, not set in the past', async () => {
  const url = `/organisations/${org}/api-keys/${scoped.key.id}`;
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const set = await api<Key>(page, 'PATCH', url, { expiresAt: future });
  expect(set.status).toBe(200);
  expect(set.body.expiresAt).not.toBeNull();
  const cleared = await api<Key>(page, 'PATCH', url, { expiresAt: null });
  expect(cleared.body.expiresAt).toBeNull();
  expect((await api(page, 'PATCH', url, { expiresAt: '2020-01-01T00:00:00.000Z' })).status).toBe(
    400,
  );
  expect((await api(page, 'PATCH', url, {})).status).toBe(400);

  const limits = await api<Key>(page, 'PATCH', url, { limits: { tokensPerDay: 1_000_000 } });
  expect(limits.body.limits.tokensPerDay).toBe(1_000_000);
  const reset = await api<Key>(page, 'PATCH', url, { limits: { tokensPerDay: null } });
  expect(reset.body.limits.tokensPerDay).toBeNull();
  expect(
    (await api(page, 'PATCH', url, { limits: { requestsPerMinute: 0 } })).status,
    'limits start at 1',
  ).toBe(400);
});

test('authentication: no key, a wrong key, a wrong scheme', async () => {
  const none = await gateway<OpenAIError>(page, null, 'GET', '/models');
  expect(none.status).toBe(401);
  expect(none.body.error.code).toBe('invalid_api_key');

  const wrong = await gateway<OpenAIError>(
    page,
    'sk-not-a-key',
    'POST',
    '/chat/completions',
    chat('x'),
  );
  expect(wrong.status).toBe(401);
  expect(wrong.body.error.message).toBe('Incorrect API key provided.');

  const basic = await page.request.fetch(`${baseUrl()}/v1/models`, {
    headers: { authorization: `Basic ${Buffer.from('a:b').toString('base64')}` },
  });
  expect(basic.status()).toBe(401);

  // Embeddings are authenticated like chat.
  const emb = await gateway<OpenAIError>(page, 'sk-nope', 'POST', '/embeddings', {
    model: 'x',
    input: 'hi',
  });
  expect(emb.status).toBe(401);
});

test('errors come in the language of Accept-Language', async () => {
  const ro = await gateway<OpenAIError>(page, 'sk-not-a-key', 'GET', '/models', undefined, {
    'accept-language': 'ro',
  });
  expect(ro.status).toBe(401);
  expect(ro.body.error.message).toBe('Cheia API furnizată este incorectă.');
  expect(ro.headers['content-language']).toBe('ro');
  expect(ro.body.error.code, 'the code stays untranslated').toBe('invalid_api_key');

  const en = await gateway<OpenAIError>(page, 'sk-not-a-key', 'GET', '/models', undefined, {
    'accept-language': 'fr',
  });
  expect(en.body.error.message, 'unknown language falls back to English').toBe(
    'Incorrect API key provided.',
  );

  // The control plane does the same.
  const cp = await api<{ message: string }>(
    page,
    'GET',
    `/organisations/${crypto.randomUUID()}`,
    undefined,
    { 'accept-language': 'ro' },
  );
  expect(cp.status).toBe(404);
  expect(cp.body.message).toBe('Organizația nu a fost găsită');
});

test('/v1/models lists what the key may use', async () => {
  await waitKnown(scoped.secret);
  const mine = await gateway<ModelList>(page, scoped.secret, 'GET', '/models');
  expect(mine.body.object).toBe('list');
  expect(mine.body.data.map((m) => m.id)).toEqual([CHAT_MODEL.name]);
  expect(mine.body.data[0]!.kind).toBe('chat');

  // The run's organisation-wide key sees both models, each with its kind.
  const all = await gateway<ModelList>(page, s.apiKey, 'GET', '/models');
  const kinds = Object.fromEntries(all.body.data.map((m) => [m.id, m.kind]));
  expect(kinds[CHAT_MODEL.name]).toBe('chat');
  expect(kinds[EMBEDDING_MODEL.name]).toBe('embedding');
});

test('wrong model, wrong endpoint, bad bodies', async () => {
  const unknown = await gateway<OpenAIError>(
    page,
    scoped.secret,
    'POST',
    '/chat/completions',
    chat('nope'),
  );
  expect(unknown.status).toBe(404);
  expect(unknown.body.error.code).toBe('model_not_found');

  // A model outside the key's pools is unknown to it, even though it exists in the organisation.
  const outside = await gateway<OpenAIError>(page, scoped.secret, 'POST', '/embeddings', {
    model: EMBEDDING_MODEL.name,
    input: 'hi',
  });
  expect(outside.status).toBe(404);

  // With the organisation-wide key the model is visible, so the endpoint is the mistake (400, not 404).
  const embOnChat = await gateway<OpenAIError>(
    page,
    s.apiKey,
    'POST',
    '/chat/completions',
    chat(EMBEDDING_MODEL.name),
  );
  expect(embOnChat.status).toBe(400);
  expect(embOnChat.body.error.message).toContain('/v1/embeddings');
  const chatOnEmb = await gateway<OpenAIError>(page, s.apiKey, 'POST', '/embeddings', {
    model: CHAT_MODEL.name,
    input: 'hi',
  });
  expect(chatOnEmb.status).toBe(400);
  expect(chatOnEmb.body.error.message).toContain('/v1/chat/completions');

  const empty = await gateway<OpenAIError>(page, scoped.secret, 'POST', '/chat/completions', {
    model: CHAT_MODEL.name,
    messages: [],
  });
  expect(empty.status).toBe(400);
  const broken = await page.request.fetch(`${baseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${scoped.secret}`, 'content-type': 'application/json' },
    data: '{not json',
  });
  expect(broken.status()).toBe(400);

  // Media is only accepted as base64 data URLs: the gateway never fetches a URL.
  const url = await gateway<OpenAIError>(page, scoped.secret, 'POST', '/chat/completions', {
    model: CHAT_MODEL.name,
    messages: [
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'https://example.com/cat.png' } }],
      },
    ],
  });
  expect(url.status).toBe(400);
});

test('a pool without a device answers 503, also when streaming', async () => {
  const res = await gateway<OpenAIError>(
    page,
    scoped.secret,
    'POST',
    '/chat/completions',
    chat(CHAT_MODEL.name),
  );
  expect(res.status).toBe(503);
  expect(res.body.error.message).toBe('No node is available for this model right now.');
  expect(res.headers['retry-after']).toBeTruthy();
  const stream = await gateway<OpenAIError>(
    page,
    scoped.secret,
    'POST',
    '/chat/completions',
    chat(CHAT_MODEL.name, { stream: true }),
  );
  expect(stream.status).toBe(503);
});

test('a request limit answers 429 with Retry-After, and lifting it works', async () => {
  limited = await createKey({
    name: `e2e-limited-${uniq()}`,
    scope: 'pools',
    poolIds: [poolId],
    limits: { requestsPerMinute: 1 },
  });
  expect(limited.key.limits.requestsPerMinute).toBe(1);
  await waitKnown(limited.secret);

  const first = await gateway(
    page,
    limited.secret,
    'POST',
    '/chat/completions',
    chat(CHAT_MODEL.name),
  );
  expect(first.status, 'within the limit (no node, so 503)').toBe(503);
  const second = await gateway<OpenAIError>(
    page,
    limited.secret,
    'POST',
    '/chat/completions',
    chat(CHAT_MODEL.name),
  );
  expect(second.status).toBe(429);
  expect(second.body.error.type).toBe('rate_limit_error');
  expect(second.body.error.message).toContain('requests per minute');
  expect(Number(second.headers['retry-after'])).toBeGreaterThan(0);
  const ro = await gateway<OpenAIError>(
    page,
    limited.secret,
    'POST',
    '/chat/completions',
    chat(CHAT_MODEL.name),
    { 'accept-language': 'ro' },
  );
  expect(ro.status).toBe(429);
  expect(ro.body.error.message).toContain('cereri pe minut');

  // Clearing the limit takes effect without a new key.
  const cleared = await api(page, 'PATCH', `/organisations/${org}/api-keys/${limited.key.id}`, {
    limits: { requestsPerMinute: null },
  });
  expect(cleared.status).toBe(200);
  await expect
    .poll(
      async () =>
        (await gateway(page, limited.secret, 'POST', '/chat/completions', chat(CHAT_MODEL.name)))
          .status,
      { timeout: 30_000, intervals: [1000] },
    )
    .toBe(503);
});

test('organisation limits can be set and are validated', async () => {
  // A throw-away organisation, so the run's own organisation keeps no limit.
  const tmp = await api<{ id: string }>(page, 'POST', '/organisations', {
    name: 'e2e limits',
    slug: `e2e-lim-${uniq()}`,
  });
  expect(tmp.status).toBe(201);
  const orgId = tmp.body.id;
  try {
    const patched = await api(page, 'PATCH', `/organisations/${orgId}`, {
      limits: { requestsPerMinute: 1000, tokensPerMinute: null, tokensPerDay: 5_000_000 },
    });
    expect(patched.status).toBe(200);
    const read = await api<{
      limits: { requestsPerMinute: number | null; tokensPerDay: number | null };
    }>(page, 'GET', `/organisations/${orgId}`);
    expect(read.body.limits.requestsPerMinute).toBe(1000);
    expect(read.body.limits.tokensPerDay).toBe(5_000_000);
    expect(
      (await api(page, 'PATCH', `/organisations/${orgId}`, { limits: { tokensPerMinute: -5 } }))
        .status,
    ).toBe(400);
  } finally {
    await api(page, 'DELETE', `/organisations/${orgId}`);
  }
});

test('a revoked key stops working and cannot be changed', async () => {
  revoked = await createKey({ name: `e2e-revoked-${uniq()}`, scope: 'org' });
  await waitKnown(revoked.secret);
  const url = `/organisations/${org}/api-keys/${revoked.key.id}`;
  expect((await api(page, 'DELETE', url)).status).toBe(204);
  await expect
    .poll(async () => (await gateway(page, revoked.secret, 'GET', '/models')).status, {
      timeout: 30_000,
      intervals: [500, 1000],
    })
    .toBe(401);
  expect((await api(page, 'DELETE', url)).status, 'revoking twice is a no-op').toBe(204);
  expect((await api(page, 'PATCH', url, { expiresAt: null })).status).toBe(409);
  const list = await api<Key[]>(page, 'GET', `/organisations/${org}/api-keys`);
  expect(list.body.find((k) => k.id === revoked.key.id)?.revokedAt).not.toBeNull();
  expect(
    (await api(page, 'DELETE', `/organisations/${org}/api-keys/${crypto.randomUUID()}`)).status,
  ).toBe(404);
});

test('the audit log records the above, without any secret', async () => {
  test.setTimeout(4 * 60_000);
  const audit = (query: string) =>
    api<AuditPage>(page, 'GET', `/organisations/${org}/audit-logs?limit=100&${query}`);

  // Control plane: written as the calls happen.
  const created = await audit('action=api_key.create');
  expect(created.status).toBe(200);
  expect(created.body.items.length).toBeGreaterThan(0);
  expect(created.body.items.every((i) => i.source === 'control_plane')).toBe(true);
  expect(created.body.items.some((i) => i.outcome === 'success')).toBe(true);
  expect((await audit('action=api_key.delete')).body.items.length).toBeGreaterThan(0);
  expect((await audit('action=pool.model_assign')).body.items.length).toBeGreaterThan(0);

  // Gateway: batched, and repeats within a minute fold into one row, so wait for the row of our key.
  await expect
    .poll(
      async () => {
        const rows = (await audit('source=gateway')).body.items;
        return {
          rejected: rows.some(
            (r) =>
              r.action === 'api_key.rejected' &&
              r.actorId === revoked.key.id &&
              r.metadata?.reason === 'revoked',
          ),
          limit: rows.some((r) => r.action === 'limit.exceeded' && r.actorId === limited.key.id),
        };
      },
      { timeout: 3 * 60_000, intervals: [5_000], message: 'the gateway audit rows never appeared' },
    )
    .toEqual({ rejected: true, limit: true });

  // Never a prompt, completion or key.
  const everything = JSON.stringify((await audit('')).body);
  for (const secret of secrets) expect(everything).not.toContain(secret);
  expect(everything).not.toContain('"hi"');
});
