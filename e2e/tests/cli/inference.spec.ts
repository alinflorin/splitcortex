import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { gatewayUrl } from '../../src/env.ts';
import { bin, chat, MODEL, startServingNode, type ServingNode } from './node.ts';

// The core path end to end: a real CLI node downloads the pool's model from the control plane, loads it in LiteRT-LM
// and serves an OpenAI request that comes in through the gateway with an API key. The model is a tiny SmolLM2: the
// assertions are about structure (status, shape, metering), never about what it says.
test.skip(!existsSync(bin) && !process.env.CI, `no CLI binary at ${bin} (set E2E_CLI_BIN)`);
test.describe.configure({ mode: 'serial', timeout: 300_000 });

let node: ServingNode;
test.beforeAll(async () => {
  node = await startServingNode();
});
test.afterAll(async () => {
  await node?.stop();
});

test('the node downloads the model and serves a chat completion through the gateway', async () => {
  await node.ready();
  const res = await chat(node.secret);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    object: string;
    model: string;
    choices: { message: { role: string; content: string }; finish_reason: string }[];
    usage: { prompt_tokens: number; completion_tokens: number };
  };
  expect(body.object).toBe('chat.completion');
  expect(body.model).toBe(MODEL);
  expect(body.choices[0]!.message.role).toBe('assistant');
  expect(body.choices[0]!.message.content.length).toBeGreaterThan(0);
  expect(body.usage.completion_tokens).toBeGreaterThan(0);
});

test('streams the answer as server-sent events', async () => {
  const res = await chat(node.secret, { stream: true });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const text = await res.text();
  expect(text).toContain('data: ');
  expect(text.trim().endsWith('data: [DONE]')).toBe(true);
});

test('lists the pool model', async () => {
  const res = await fetch(`${gatewayUrl}/v1/models`, {
    headers: { authorization: `Bearer ${node.secret}` },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: { id: string }[] };
  expect(body.data.map((m) => m.id)).toContain(MODEL);
});

test('refuses a missing or wrong key and an unknown model', async () => {
  expect((await chat('sc_not-a-key')).status).toBe(401);
  expect((await chat(node.secret, { model: 'no-such-model' })).status).toBe(404);
});
