import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  addPlaceholderEmbeddingPool,
  bin,
  chat,
  EMBED_MODEL,
  embed,
  embeddingModelUrl,
  listModels,
  MODEL,
  PLACEHOLDER_EMBED_MODEL,
  startEmbeddingNode,
  startServingNode,
  type ServingNode,
} from '../../src/serving-node.ts';

// Embedding models: `kind`, `POST /v1/embeddings` and what the gateway decides from the model alone (part 1, with the
// usual tiny chat model and a placeholder embedding pool), then the real vectors of a real embedding model (part 2,
// with EmbeddingGemma by default; E2E_EMBEDDING_MODEL_URL points them to another Hugging Face .litertlm embedding model).
test.skip(!existsSync(bin) && !process.env.CI, `no CLI binary at ${bin} (set E2E_CLI_BIN)`);

interface ApiErrorBody {
  error: { message: string; type: string; code: string };
}
const errorOf = async (res: Response) => ((await res.json()) as ApiErrorBody).error;

test.describe('what the gateway decides from the model kind', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  let node: ServingNode;
  test.beforeAll(async () => {
    node = await startServingNode();
    await node.ready();
    await addPlaceholderEmbeddingPool(node);
  });
  test.afterAll(async () => {
    await node?.stop();
  });

  test('/v1/models says which models are chat and which are embeddings', async () => {
    const models = await listModels(node.secret);
    expect(models.find((m) => m.id === MODEL)?.kind).toBe('chat');
    expect(models.find((m) => m.id === PLACEHOLDER_EMBED_MODEL)?.kind).toBe('embedding');
  });

  test('a chat model on /v1/embeddings is refused with wrong_model_kind', async () => {
    const res = await embed(node.secret, { model: MODEL });
    expect(res.status).toBe(400);
    const e = await errorOf(res);
    expect(e.code).toBe('wrong_model_kind');
    expect(e.type).toBe('invalid_request_error');
  });

  test('an embedding model on /v1/chat/completions is refused with wrong_model_kind', async () => {
    const res = await chat(node.secret, { model: PLACEHOLDER_EMBED_MODEL });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('wrong_model_kind');
  });

  test('an unknown model is 404 model_not_found and a bad key is 401', async () => {
    const res = await embed(node.secret, { model: 'no-such-model' });
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('model_not_found');
    expect((await embed('sc_not-a-key')).status).toBe(401);
  });

  test('the input and the options are validated (400 invalid_request)', async () => {
    const bad: [string, Record<string, unknown>][] = [
      ['empty string', { input: '' }],
      ['blank string', { input: '   ' }],
      ['empty list', { input: [] }],
      ['an empty entry', { input: ['fine', ''] }],
      ['129 inputs', { input: Array.from({ length: 129 }, (_, i) => `text ${i}`) }],
      ['a 32001-character input', { input: 'x'.repeat(32_001) }],
      ['an unknown task', { input: 'hello', task: 'translate' }],
      ['an unknown encoding_format', { input: 'hello', encoding_format: 'int8' }],
      ['dimensions 0', { input: 'hello', dimensions: 0 }],
    ];
    for (const [what, body] of bad) {
      const res = await embed(node.secret, { model: PLACEHOLDER_EMBED_MODEL, ...body });
      expect(res.status, what).toBe(400);
      expect((await errorOf(res)).code, what).toBe('invalid_request');
    }
  });

  test('the limits of the request are inclusive: 128 inputs pass validation', async () => {
    // No node serves the placeholder pool, so a valid request ends in 503 (not in a 400).
    const res = await embed(node.secret, {
      model: PLACEHOLDER_EMBED_MODEL,
      input: Array.from({ length: 128 }, (_, i) => `text ${i}`),
      task: 'query',
      encoding_format: 'base64',
      dimensions: 8,
    });
    expect(res.status).toBe(503);
  });

  test('a pool with no node for the model answers 503', async () => {
    const res = await embed(node.secret, { model: PLACEHOLDER_EMBED_MODEL });
    expect(res.status).toBe(503);
  });

  test('an organisation-wide request limit also applies to embeddings (429)', async () => {
    const { ws } = node;
    await ws.cp.setOrgLimits(ws.org.id, { requestsPerMinute: 1 });
    try {
      let refused = false;
      for (let i = 0; i < 40 && !refused; i++) {
        refused = (await embed(node.secret, { model: PLACEHOLDER_EMBED_MODEL })).status === 429;
        if (!refused) await new Promise((r) => setTimeout(r, 500));
      }
      expect(refused, 'no 429 within 20 s').toBe(true);
    } finally {
      await ws.cp.setOrgLimits(ws.org.id, { requestsPerMinute: null });
    }
  });
});

test.describe('real embeddings', () => {
  test.skip(
    !embeddingModelUrl,
    'no embedding model link (E2E_EMBEDDING_MODEL_URL is empty and the default is gone)',
  );
  test.describe.configure({ mode: 'serial', timeout: 600_000 });

  let node: ServingNode;
  test.beforeAll(async () => {
    node = await startEmbeddingNode();
    await node.ready();
  });
  test.afterAll(async () => {
    await node?.stop();
  });

  interface EmbeddingsBody {
    object: string;
    model: string;
    data: { object: string; index: number; embedding: number[] | string }[];
    usage: { prompt_tokens: number; total_tokens: number };
  }
  const call = async (body: Record<string, unknown>): Promise<EmbeddingsBody> => {
    const res = await embed(node.secret, body);
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as EmbeddingsBody;
  };
  const vec = (b: EmbeddingsBody, i = 0) => b.data[i]!.embedding as number[];
  const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
  const cosine = (a: number[], b: number[]) => dot(a, b) / (norm(a) * norm(b));

  test('returns the OpenAI list of unit-length vectors with usage', async () => {
    const body = await call({ input: 'The quick brown fox' });
    expect(body.object).toBe('list');
    expect(body.model).toBe(EMBED_MODEL);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ object: 'embedding', index: 0 });
    expect(vec(body).length).toBeGreaterThan(1);
    expect(vec(body).every(Number.isFinite)).toBe(true);
    expect(norm(vec(body))).toBeCloseTo(1, 2);
    expect(body.usage.prompt_tokens).toBeGreaterThan(0);
    expect(body.usage.total_tokens).toBe(body.usage.prompt_tokens);
  });

  test('a batch comes back in the order of the inputs, one vector each', async () => {
    const inputs = ['a cat on a mat', 'quarterly revenue grew by ten percent', 'how to bake bread'];
    const batch = await call({ input: inputs });
    expect(batch.data.map((d) => d.index)).toEqual([0, 1, 2]);
    // The same text alone gives (nearly) the same vector as at its place in the batch.
    for (const [i, text] of inputs.entries()) {
      const alone = await call({ input: text });
      expect(cosine(vec(batch, i), vec(alone))).toBeGreaterThan(0.99);
    }
    expect(cosine(vec(batch, 0), vec(batch, 1))).toBeLessThan(0.999);
  });

  test('concurrent requests are all answered, each with its own vectors', async () => {
    const texts = ['red apple', 'blue ocean', 'green forest', 'yellow sun'];
    const alone = await Promise.all(texts.map((t) => call({ input: t })));
    const together = await Promise.all(texts.map((t) => call({ input: [t, `${t} again`] })));
    for (const [i, b] of together.entries()) {
      expect(b.data).toHaveLength(2);
      expect(cosine(vec(b, 0), vec(alone[i]!))).toBeGreaterThan(0.99);
    }
  });

  test('similar texts are closer than unrelated ones', async () => {
    const b = await call({
      input: [
        'A kitten sleeps on the sofa',
        'A cat naps on the couch',
        'The stock market fell sharply',
      ],
    });
    expect(cosine(vec(b, 0), vec(b, 1))).toBeGreaterThan(cosine(vec(b, 0), vec(b, 2)));
  });

  test('dimensions truncates the vector and renormalises it', async () => {
    const full = vec(await call({ input: 'truncate me' }));
    const dims = 64;
    expect(full.length).toBeGreaterThan(dims);
    const cut = vec(await call({ input: 'truncate me', dimensions: dims }));
    expect(cut).toHaveLength(dims);
    expect(norm(cut)).toBeCloseTo(1, 2);
    // It is the head of the full vector, scaled back to unit length.
    expect(cosine(cut, full.slice(0, dims))).toBeGreaterThan(0.999);
    // More dimensions than the model has is the client's mistake.
    const tooMany = await embed(node.secret, { input: 'x', dimensions: full.length + 1 });
    expect(tooMany.status).toBe(400);
  });

  test('encoding_format base64 is the same vector as little-endian float32 bytes', async () => {
    const floats = vec(await call({ input: 'same either way' }));
    const b = await call({ input: 'same either way', encoding_format: 'base64' });
    const encoded = b.data[0]!.embedding;
    expect(typeof encoded).toBe('string');
    const bytes = Buffer.from(encoded as string, 'base64');
    expect(bytes.length).toBe(floats.length * 4);
    const decoded = Array.from({ length: floats.length }, (_, i) => bytes.readFloatLE(i * 4));
    expect(cosine(decoded, floats)).toBeGreaterThan(0.9999);
  });

  test('the task changes the vector for the same text', async () => {
    const text = 'wireless headphones with noise cancelling';
    const none = vec(await call({ input: text }));
    const query = vec(await call({ input: text, task: 'query' }));
    const document = vec(await call({ input: text, task: 'document' }));
    expect(cosine(query, document)).toBeLessThan(0.99999);
    expect(cosine(query, none)).toBeLessThan(0.99999);
    // The same task twice is deterministic.
    expect(cosine(query, vec(await call({ input: text, task: 'query' })))).toBeGreaterThan(0.9999);
  });

  test('the embedding model refuses chat and is listed with its kind', async () => {
    const res = await chat(node.secret, { model: EMBED_MODEL });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('wrong_model_kind');
    expect((await listModels(node.secret)).find((m) => m.id === EMBED_MODEL)?.kind).toBe(
      'embedding',
    );
  });

  test('a pool that serves embeddings cannot be benchmarked (409)', async () => {
    const { ws } = node;
    expect(
      (await ws.cp.send('POST', `/organisations/${ws.org.id}/pools/${ws.pool.id}/benchmarks`))
        .status,
    ).toBe(409);
  });

  test('embeddings are metered: requests and input tokens show up in the usage', async () => {
    const { ws } = node;
    const before = (await ws.cp.usageByKey(ws.org.id)).totals;
    await call({ input: 'count me' });
    const usage = await (async () => {
      for (let i = 0; i < 30; i++) {
        const t = (await ws.cp.usageByKey(ws.org.id)).totals;
        if (t.requests > before.requests) return t;
        await new Promise((r) => setTimeout(r, 2_000));
      }
      return (await ws.cp.usageByKey(ws.org.id)).totals;
    })();
    expect(usage.requests).toBeGreaterThan(before.requests);
    expect(usage.tokensIn).toBeGreaterThan(before.tokensIn);
  });
});
