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

// What a customer's integration runs into at the OpenAI edge, without any device: a key that runs out, limits shared
// by every key of the organisation, "last used" on the key list, and the requests the gateway refuses before it ever
// looks for a device (so a wrong request is a 400 that says why, never a 503 "try later"). Throw-away organisation,
// two tiny uploaded models (one chat, one embedding) served by pools without devices.
test.describe.configure({ mode: 'serial' });

interface Created {
  key: { id: string; lastUsedAt: string | null };
  secret: string;
}
interface Key {
  id: string;
  lastUsedAt: string | null;
}
interface AuditPage {
  items: { action: string; actorId: string | null; metadata: Record<string, unknown> | null }[];
}

let page: Page;
let org: string;
let chatModel: string;
let embedModel: string;
const keyIds: string[] = [];

const orgApi = (path = '') => `/organisations/${org}${path}`;
const chat = (extra: object = {}, model = chatModel) => ({
  model,
  messages: [{ role: 'user', content: 'hi' }],
  max_tokens: 4,
  ...extra,
});
const PNG = `data:image/png;base64,${Buffer.from('not really a png').toString('base64')}`;
const user = (content: unknown, role = 'user') => ({ role, content });

async function newKey(body: object): Promise<Created> {
  const res = await api<Created>(page, 'POST', orgApi('/api-keys'), body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  keyIds.push(res.body.key.id);
  await waitKnown(res.body.secret);
  return res.body;
}

async function waitKnown(secret: string) {
  await expect
    .poll(async () => (await gateway(page, secret, 'GET', '/models')).status, {
      timeout: 30_000,
      intervals: [500, 1000],
      message: 'the gateway never accepted the key',
    })
    .toBe(200);
}

/** The per-minute counters reset on the minute: start a sequence early in it so it cannot straddle two windows. */
async function earlyInTheMinute(maxSecond = 35) {
  const second = new Date().getSeconds();
  if (second > maxSecond) await page.waitForTimeout((61 - second) * 1000);
}

test.beforeAll(async ({ browser }) => {
  page = await userPage(browser, 0);
  org = (await createOrg(page, 'edge')).id;
  chatModel = `edge-chat-${uniq()}`;
  embedModel = `edge-embed-${uniq()}`;
  for (const [name, kind] of [
    [chatModel, 'chat'],
    [embedModel, 'embedding'],
  ] as const) {
    const modelId = await uploadTinyModel(page, org, name, kind);
    const pool = await api<{ id: string }>(page, 'POST', orgApi('/pools'), {
      name: `edge-${kind}-${uniq()}`,
    });
    expect(pool.status).toBe(201);
    expect(
      (await api(page, 'PUT', orgApi(`/pools/${pool.body.id}/models/${modelId}`))).status,
    ).toBe(204);
  }
});

test.afterAll(async () => {
  await deleteOrg(page, org);
  await page.context().close();
});

// ---------------------------------------------------------------------------------------------------------------------
// Keys and limits
// ---------------------------------------------------------------------------------------------------------------------

test('a key that expires stops working, and the log says why', async () => {
  test.setTimeout(4 * 60_000);
  const key = await newKey({
    name: `edge-expiring-${uniq()}`,
    scope: 'org',
    expiresAt: new Date(Date.now() + 15_000).toISOString(),
  });
  // Still valid for a few seconds (15)...
  expect((await gateway(page, key.secret, 'GET', '/models')).status).toBe(200);
  // ...then refused on every endpoint, with the standard error and nothing that helps a guesser.
  await expect
    .poll(async () => (await gateway(page, key.secret, 'GET', '/models')).status, {
      timeout: 60_000,
      intervals: [1_000],
      message: 'the key never expired',
    })
    .toBe(401);
  const res = await gateway<OpenAIError>(page, key.secret, 'POST', '/chat/completions', chat());
  expect(res.status).toBe(401);
  expect(res.body.error.type).toBe('invalid_request_error');
  expect(
    (await gateway(page, key.secret, 'POST', '/embeddings', { model: embedModel, input: 'x' }))
      .status,
  ).toBe(401);
  // The admin sees it in the key list and in the audit log (batched, so poll).
  const list = await api<{ id: string; expiresAt: string | null }[]>(
    page,
    'GET',
    orgApi('/api-keys'),
  );
  expect(Date.parse(list.body.find((k) => k.id === key.key.id)!.expiresAt!)).toBeLessThan(
    Date.now(),
  );
  await expect
    .poll(
      async () =>
        (
          await api<AuditPage>(page, 'GET', orgApi('/audit-logs?source=gateway&limit=100'))
        ).body.items.some((r) => r.actorId === key.key.id && r.metadata?.reason === 'expired'),
      { timeout: 3 * 60_000, intervals: [5_000], message: 'no "expired" audit row' },
    )
    .toBe(true);
  // A new expiry makes it work again (the admin extends a key instead of replacing it).
  const extended = await api(page, 'PATCH', orgApi(`/api-keys/${key.key.id}`), {
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  expect(extended.status).toBe(200);
  await waitKnown(key.secret);
});

test('organisation limits are shared by every key of the organisation', async () => {
  const a = await newKey({ name: `edge-a-${uniq()}`, scope: 'org' });
  const b = await newKey({ name: `edge-b-${uniq()}`, scope: 'org' });
  const ask = (secret: string, body: object = chat()) =>
    gateway<OpenAIError>(page, secret, 'POST', '/chat/completions', body);
  // The gateway learns a changed limit a moment after the call returns, and every request counts meanwhile (the
  // counter does not wait for the limit). So: ask with both keys in turn until the first refusal. The keys have no limit
  // of their own, so a refusal can only be the organisation's, and from then on it must hold for both of them.
  const untilRefused = async (body: object) => {
    for (let i = 0; i < 30; i++) {
      const res = await ask(i % 2 ? b.secret : a.secret, body);
      if (res.status === 429) return res;
      expect(res.status, `request ${i + 1} before the limit`).toBe(503); // no node: the pool has no device
      await page.waitForTimeout(300);
    }
    throw new Error('the organisation limit never applied');
  };
  try {
    await earlyInTheMinute();
    expect((await api(page, 'PATCH', orgApi(), { limits: { requestsPerMinute: 2 } })).status).toBe(
      200,
    );
    const refused = await untilRefused(chat());
    expect(refused.body.error.type).toBe('rate_limit_error');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    for (const key of [a, b]) {
      expect((await ask(key.secret)).status, 'refused for every key of the organisation').toBe(429);
    }

    // The same for tokens: a long prompt counts against the minute's tokens before anything is generated.
    expect(
      (await api(page, 'PATCH', orgApi(), { limits: { requestsPerMinute: null } })).status,
    ).toBe(200);
    await earlyInTheMinute();
    expect((await api(page, 'PATCH', orgApi(), { limits: { tokensPerMinute: 50 } })).status).toBe(
      200,
    );
    const long = chat({ messages: [user('word '.repeat(200))] }); // about 250 tokens
    const byTokens = await untilRefused(long);
    expect(byTokens.body.error.message).toContain('tokens per minute');
    for (const key of [a, b]) {
      expect((await ask(key.secret, long)).status, 'tokens are shared too').toBe(429);
    }
  } finally {
    await api(page, 'PATCH', orgApi(), {
      limits: { requestsPerMinute: null, tokensPerMinute: null, tokensPerDay: null },
    });
  }
  // Lifting works without new keys.
  await expect
    .poll(async () => (await ask(a.secret)).status, { timeout: 30_000, intervals: [1_000] })
    .toBe(503);
  expect((await ask(b.secret)).status).toBe(503);
});

test('a key shows when it was last used', async () => {
  test.setTimeout(3 * 60_000);
  const key = await newKey({ name: `edge-used-${uniq()}`, scope: 'org' });
  const lastUsed = async () =>
    (await api<Key[]>(page, 'GET', orgApi('/api-keys'))).body.find((k) => k.id === key.key.id)
      ?.lastUsedAt;
  // newKey already used it once to wait for the gateway: the timestamp is written at most once a minute.
  await expect
    .poll(lastUsed, { timeout: 2 * 60_000, intervals: [5_000], message: 'lastUsedAt never set' })
    .not.toBeNull();
  const first = Date.parse((await lastUsed())!);
  expect(Math.abs(Date.now() - first)).toBeLessThan(5 * 60_000);
  // A key nobody used says so.
  const idle = await api<Created>(page, 'POST', orgApi('/api-keys'), {
    name: `edge-idle-${uniq()}`,
    scope: 'org',
  });
  keyIds.push(idle.body.key.id);
  expect(idle.body.key.lastUsedAt).toBeNull();
});

// ---------------------------------------------------------------------------------------------------------------------
// What the gateway refuses before it looks for a device
// ---------------------------------------------------------------------------------------------------------------------

test.describe('embeddings requests', () => {
  let secret: string;
  test.beforeAll(async () => {
    secret = (await newKey({ name: `edge-emb-${uniq()}`, scope: 'org' })).secret;
  });

  const embed = (body: object) =>
    gateway<OpenAIError>(page, secret, 'POST', '/embeddings', { model: embedModel, ...body });

  test('a wrong request is a 400 that says what is wrong', async () => {
    const cases: [string, object][] = [
      ['no input at all', { input: [] }],
      ['an empty text', { input: '' }],
      ['a blank text among others', { input: ['fine', '   '] }],
      ['129 texts, one more than a request may carry', { input: Array(129).fill('x') }],
      ['a text of 32,001 characters', { input: 'x'.repeat(32_001) }],
      ['a task nobody knows', { input: 'x', task: 'poetry' }],
      ['zero dimensions', { input: 'x', dimensions: 0 }],
      ['negative dimensions', { input: 'x', dimensions: -3 }],
      ['an encoding that does not exist', { input: 'x', encoding_format: 'hex' }],
      ['a number as input', { input: 42 }],
    ];
    for (const [what, body] of cases) {
      const res = await embed(body);
      expect(res.status, what).toBe(400);
      expect(res.body.error.type, what).toBe('invalid_request_error');
      expect(res.body.error.message.length, what).toBeGreaterThan(0);
    }
  });

  test('the edges of the allowed are not refused', async () => {
    // 128 texts, a text of exactly 32,000 characters, every known task, both encodings: all pass validation and meet
    // "no node" (503), which is the proof they were not refused earlier.
    const ok: [string, object][] = [
      ['128 texts', { input: Array(128).fill('x') }],
      ['32,000 characters', { input: 'x'.repeat(32_000) }],
      ...['query', 'document', 'classification', 'clustering', 'similarity'].map(
        (task): [string, object] => [`task ${task}`, { input: 'x', task }],
      ),
      ['base64', { input: 'x', encoding_format: 'base64' }],
      ['float', { input: 'x', encoding_format: 'float' }],
      ['dimensions', { input: 'x', dimensions: 256 }],
    ];
    for (const [what, body] of ok) expect((await embed(body)).status, what).toBe(503);
  });

  test('the answer to a refusal is in the language asked for', async () => {
    const ro = await gateway<OpenAIError>(
      page,
      secret,
      'POST',
      '/embeddings',
      { model: embedModel, input: [] },
      { 'accept-language': 'ro' },
    );
    const en = await embed({ input: [] });
    expect([ro.status, en.status]).toEqual([400, 400]);
    expect(ro.body.error.message).not.toBe(en.body.error.message);
    expect(ro.body.error.code).toBe(en.body.error.code);
  });
});

test.describe('chat requests', () => {
  let secret: string;
  test.beforeAll(async () => {
    secret = (await newKey({ name: `edge-chat-${uniq()}`, scope: 'org' })).secret;
  });

  const send = (messages: unknown[]) =>
    gateway<OpenAIError>(page, secret, 'POST', '/chat/completions', chat({ messages }));

  test('a wrong message is a 400 that says what is wrong, not a 503', async () => {
    const cases: [string, unknown[], string][] = [
      [
        'an image from the system',
        [user([{ type: 'image_url', image_url: { url: PNG } }], 'system')],
        'invalid_media_role',
      ],
      [
        'an image from the assistant',
        [user([{ type: 'image_url', image_url: { url: PNG } }], 'assistant')],
        'invalid_media_role',
      ],
      [
        'an image type nobody reads',
        [user([{ type: 'image_url', image_url: { url: 'data:image/tiff;base64,AAAA' } }])],
        'unsupported_media_type',
      ],
      [
        'an audio format nobody reads',
        [user([{ type: 'input_audio', input_audio: { data: 'AAAA', format: 'xyz' } }])],
        'unsupported_media_type',
      ],
      [
        'an image that is not base64',
        [user([{ type: 'image_url', image_url: { url: 'data:image/png;base64,!!!' } }])],
        'invalid_base64',
      ],
      [
        'audio that is not base64',
        [user([{ type: 'input_audio', input_audio: { data: '!!!', format: 'wav' } }])],
        'invalid_base64',
      ],
      [
        'a data URL that is not base64',
        [user([{ type: 'image_url', image_url: { url: 'data:image/png,AAAA' } }])],
        'invalid_data_url',
      ],
      [
        'an image by address',
        [user([{ type: 'image_url', image_url: { url: 'https://example.com/cat.png' } }])],
        'unsupported_media_url',
      ],
      [
        'an empty image',
        [user([{ type: 'image_url', image_url: { url: 'data:image/png;base64,' } }])],
        'invalid_request',
      ],
      [
        'a video',
        [user([{ type: 'video_url', video_url: { url: 'x' } }])],
        'unsupported_content_type',
      ],
      ['content that is a number', [user(42)], 'invalid_request'],
    ];
    for (const [what, messages, code] of cases) {
      const res = await send(messages);
      expect(res.status, what).toBe(400);
      expect(res.body.error.code, what).toBe(code);
    }
  });

  test('too many pictures in one request is a 413', async () => {
    const image = { type: 'image_url', image_url: { url: PNG } };
    const res = await send([user(Array(65).fill(image))]);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('media_too_large');
    // Sixty-four is allowed (and meets "no node").
    expect((await send([user(Array(64).fill(image))])).status).toBe(503);
  });

  test('a picture of a few megabytes gets through the whole edge', async () => {
    const big = `data:image/png;base64,${Buffer.alloc(6 * 1024 * 1024, 5).toString('base64')}`;
    const res = await send([
      user([
        { type: 'text', text: 'what is this?' },
        { type: 'image_url', image_url: { url: big } },
      ]),
    ]);
    // The ingress, the gateway's limit and the parsing all let ~8 MB through: the first refusal is "no node".
    expect(res.status).toBe(503);
  });

  test('a conversation with every role and text parts is accepted', async () => {
    const res = await send([
      user('You answer in one word.', 'system'),
      user('Hi'),
      user('Hello.', 'assistant'),
      user([{ type: 'text', text: 'Say it again.' }]),
    ]);
    expect(res.status).toBe(503);
  });
});
