import { expect, test, type Browser, type Page } from '@playwright/test';
import { cp, openai, poolNodes } from './api';
import { authFile, baseUrl } from './env';
import { loadState } from './state';

/** One node type under test. `join` enrolls with the code and starts serving; `stop` removes every trace. */
export interface NodeDriver {
  title: string;
  /** Reason to skip (missing tool, no device), or null. */
  unavailable(): Promise<string | null>;
  join(code: string, ctx: { browser: Browser }): Promise<void>;
  stop(): Promise<void>;
}

type PoolKind = 'chat' | 'embeddings';

/** Reads the code from the pool page's "Add device" dialog, as an admin would. */
async function newEnrollmentCode(page: Page, orgId: string, poolId: string): Promise<string> {
  await page.goto(`${baseUrl()}/organisations/${orgId}/pools/${poolId}`);
  await page.getByRole('button', { name: 'Add device' }).first().click();
  const code = await page.getByTestId('enroll-code').innerText();
  expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{6}$/);
  return code;
}

async function onlineNodeId(page: Page, orgId: string, poolId: string, timeout: number) {
  let id = '';
  await expect
    .poll(
      async () => {
        const online = (await poolNodes(page, orgId, poolId)).find((n) => n.status === 'online');
        id = online?.id ?? '';
        return id;
      },
      { timeout, intervals: [3_000], message: 'the node never came online' },
    )
    .not.toBe('');
  return id;
}

/**
 * Per pool (chat, then embeddings) the node types take turns in the same pool: enroll by typing a code, wait until it
 * is online (it loads the pool's model first), use it through the Playground and the OpenAI API, then revoke it and
 * see it disappear before the next one comes. One node at a time, so it answers; a failing node does not skip the next.
 */
export function nodeSuite(kind: PoolKind, drivers: NodeDriver[]) {
  test.describe(`${kind} pool`, () => {
    test.use({ storageState: authFile(0) });
    test.afterAll(async () => {
      for (const d of drivers) await d.stop();
    });

    for (const driver of drivers) {
      test(`${driver.title}`, async ({ page, browser }) => {
        test.setTimeout(40 * 60_000);
        const why = await driver.unavailable();
        test.skip(!!why, why ?? '');
        const s = loadState();
        const poolId = kind === 'chat' ? s.chatPoolId : s.embedPoolId;
        await page.goto(baseUrl());

        // A pool without a model gives the node nothing to load ("The pool serves no model"): fail here, clearly.
        const served = await cp(page, 'GET', `/organisations/${s.orgId}/pools/${poolId}/models`);
        expect(
          ((await served.json()) as unknown[]).length,
          `the ${kind} pool must serve a model (setup assigns it)`,
        ).toBe(1);

        const code = await newEnrollmentCode(page, s.orgId, poolId);
        await driver.join(code, { browser });
        // The dialog closes by itself when the device arrives; then the model download and load.
        const nodeId = await onlineNodeId(page, s.orgId, poolId, 30 * 60_000);

        await page.goto(`${baseUrl()}/organisations/${s.orgId}/nodes/${nodeId}`);
        await expect(page.getByText('Online').first()).toBeVisible();

        const models = (await (await openai(page, s.apiKey, '/models')).json()) as {
          data: { id: string }[];
        };
        expect(models.data.length).toBeGreaterThan(0);

        if (kind === 'chat') {
          const model = models.data.find((m) => m.id.includes('chat'))?.id ?? models.data[0]!.id;
          await chatInPlayground(page, s.apiKey);
          await chatOverApi(page, s.apiKey, model);
        } else {
          const model =
            models.data.find((m) => m.id.includes('embedding'))?.id ?? models.data[0]!.id;
          const res = await openai(page, s.apiKey, '/embeddings', {
            model,
            input: ['hello', 'world'],
          });
          expect(res.status()).toBe(200);
          const body = (await res.json()) as { data: { embedding: number[] }[] };
          expect(body.data).toHaveLength(2);
          expect(body.data[0]!.embedding.length).toBeGreaterThan(100);
        }

        // Revoking disconnects the device; nothing can be served any more.
        const del = await cp(page, 'DELETE', `/organisations/${s.orgId}/nodes/${nodeId}`);
        expect(del.status()).toBe(204);
        await driver.stop();
        await expect
          .poll(async () => (await poolNodes(page, s.orgId, poolId)).length, { timeout: 60_000 })
          .toBe(0);
      });
    }
  });
}

async function chatInPlayground(page: Page, apiKey: string) {
  await page.goto(`${baseUrl()}/playground`);
  await page.getByLabel('API key').fill(apiKey);
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByLabel('Message').fill('Say hello in one short sentence.');
  await page.getByRole('button', { name: 'Send' }).click();
  // The stats line appears when the answer is complete.
  await expect(page.getByText(/ms to first token/)).toBeVisible({ timeout: 5 * 60_000 });
  await expect(page.getByText('Something went wrong.')).toHaveCount(0);
}

async function chatOverApi(page: Page, apiKey: string, model: string) {
  const messages = [{ role: 'user', content: 'Say hello.' }];
  const res = await openai(page, apiKey, '/chat/completions', { model, messages, max_tokens: 24 });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage: { completion_tokens: number };
  };
  expect(body.choices[0]!.message.content.length).toBeGreaterThan(0);
  expect(body.usage.completion_tokens).toBeGreaterThan(0);

  const sse = await openai(page, apiKey, '/chat/completions', {
    model,
    messages,
    max_tokens: 24,
    stream: true,
  });
  expect(sse.status()).toBe(200);
  const text = await sse.text();
  expect(text).toContain('data: [DONE]');

  const bad = await openai(page, 'sk-not-a-key', '/chat/completions', { model, messages });
  expect(bad.status()).toBe(401);
}
