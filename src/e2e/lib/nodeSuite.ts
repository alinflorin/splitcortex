import { expect, test, type Browser, type Page } from '@playwright/test';
import { cp, openai, poolNodes } from './api';
import { authFile, baseUrl, type NodeType } from './env';
import { loadState } from './state';

/** One node type under test. `join` enrolls with the code and starts serving; `stop` removes every trace. */
export interface NodeDriver {
  title: string;
  /** Reason to skip (missing tool, no device), or null. */
  unavailable(): Promise<string | null>;
  join(code: string, ctx: { browser: Browser }): Promise<void>;
  stop(): Promise<void>;
}

/** Wall clock marker for the long steps (shows where a run spends its time). */
const mark = (what: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${what}`);

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
 * One node type, in a pool pair of its own (a chat pool and an embeddings pool, with an API key scoped to just those):
 * enroll by typing a code, wait until it is online (it loads the pool's model first), use it through the Playground and
 * the OpenAI API, then revoke it and see it disappear. One node per pool, so it is the one that answers. Other node
 * types have their own pools and run at the same time (see playwright.config.ts).
 */
export function nodeSuite(type: NodeType, driver: NodeDriver) {
  test.describe(`${type} node`, () => {
    test.use({ storageState: authFile(0) });
    test.afterAll(async () => {
      await driver.stop();
    });

    for (const kind of ['chat', 'embeddings'] as const) {
      test(`${kind} pool`, async ({ page, browser }) => {
        test.setTimeout(40 * 60_000);
        const t0 = Date.now();
        const lap = (what: string) =>
          console.log(`[${type}/${kind}] ${((Date.now() - t0) / 1000).toFixed(0)}s ${what}`);
        const why = await driver.unavailable();
        test.skip(!!why, why ?? '');
        const run = loadState();
        const s = { orgId: run.orgId, ...run.nodes[type]! };
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
        lap('enrolled');
        // The dialog closes by itself when the device arrives; then the model download and load.
        const nodeId = await onlineNodeId(page, s.orgId, poolId, 30 * 60_000);

        lap('online (model loaded)');
        await page.goto(`${baseUrl()}/organisations/${s.orgId}/nodes/${nodeId}`);
        await expect(page.getByText('Online').first()).toBeVisible();
        await checkNodePage(page, s.orgId, poolId, nodeId);

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

        lap('served (playground, api)');
        await checkOperations(page, s.orgId, poolId, nodeId, kind, s.apiKey);

        lap('operations done');
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

/** The device as an admin sees it: the pool's card for it, its page (live status, engine settings, device), restart. */
async function checkNodePage(page: Page, orgId: string, poolId: string, nodeId: string) {
  // The pool page counts it and links to it.
  await page.goto(`${baseUrl()}/organisations/${orgId}/pools/${poolId}`);
  // (Older, offline devices may still be listed: the count is not asserted.)
  await expect(page.getByText('Online').first()).toBeVisible();
  await expect(page.getByText('No devices in this pool yet.')).toHaveCount(0);

  await page.goto(`${baseUrl()}/organisations/${orgId}/nodes/${nodeId}`);
  await expect(page.getByRole('link', { name: /Back to pool/ })).toBeVisible();
  for (const card of [
    'Live status',
    'Engine settings',
    'Device',
    'CPU',
    'Memory',
    'Load',
    'Connection',
  ]) {
    await expect(page.getByText(card, { exact: true }).first(), card).toBeVisible();
  }
  // What the device runs on, as the node reports it once the model is downloaded and the engine loaded. "Online" only
  // means connected, so wait for it (several nodes load their models at the same time).
  await expect(page.getByText('Running on')).toBeVisible({ timeout: 5 * 60_000 });
  await expect(page.getByText(/^(CPU|GPU)$/).first()).toBeVisible();
  await expect(page.getByText('Key fingerprint')).toBeVisible();
  await expect(page.getByText('Could not load data')).toHaveCount(0);

  // The overrides are offered; "Device decides" is the default.
  await expect(page.getByLabel('Compute backend')).toBeVisible();
  await expect(page.getByLabel('Maximum context (tokens)')).toBeVisible();
  await page.getByLabel('Maximum context (tokens)').fill('10');
  await expect(page.getByText(/Enter a whole number from \d+ to \d+/)).toBeVisible();
  await page.getByLabel('Maximum context (tokens)').fill('');

  // Restart and revoke ask first; Cancel leaves the device alone.
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText(/^Restart /)).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(page.getByRole('alertdialog').getByText(/^Revoke /)).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByText('Online').first()).toBeVisible();
}

/** The numbers and controls that only make sense once a device has served: usage, metrics, audit, overrides, benchmark, restart. */
async function checkOperations(
  page: Page,
  orgId: string,
  poolId: string,
  nodeId: string,
  kind: PoolKind,
  apiKey: string,
) {
  const org = `/organisations/${orgId}`;
  const served = async () => {
    const models = (await (await openai(page, apiKey, '/models')).json()) as {
      data: { id: string }[];
    };
    const id =
      models.data.find((m) => m.id.includes(kind === 'chat' ? 'chat' : 'embedding'))?.id ??
      models.data[0]!.id;
    const res =
      kind === 'chat'
        ? await openai(page, apiKey, '/chat/completions', {
            model: id,
            messages: [{ role: 'user', content: 'Say hi.' }],
            max_tokens: 16,
          })
        : await openai(page, apiKey, '/embeddings', { model: id, input: 'hi' });
    return res.status();
  };
  // A request that is served, however long a reload took.
  const serves = (timeout: number, message: string) =>
    expect.poll(served, { timeout, intervals: [5_000], message }).toBe(200);

  // Usage: the requests above were counted (the gateway writes in batches, so poll), in the API and on the page.
  await expect
    .poll(
      async () => (await (await cp(page, 'GET', `${org}/usage`)).json()).totals.requests as number,
      { timeout: 3 * 60_000, intervals: [5_000], message: 'usage never showed the requests' },
    )
    .toBeGreaterThan(0);
  await page.goto(`${baseUrl()}${org}/usage`);
  await expect(page.getByText('Requests', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('No usage in this period.')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Group by' }).click();
  await page.getByRole('option', { name: 'Pool', exact: true }).click();
  await expect(page.getByText('No usage in this period.')).toHaveCount(0);
  await expect(page.getByText('Could not load data')).toHaveCount(0);

  // Metrics: the gateway's per-minute numbers and the device's own telemetry arrive.
  await expect
    .poll(
      async () => {
        const m = (await (await cp(page, 'GET', `${org}/metrics`)).json()) as {
          pools: { requests: number }[];
          nodes: { nodesReporting: number }[];
        };
        return [m.pools.some((p) => p.requests > 0), m.nodes.some((n) => n.nodesReporting > 0)];
      },
      { timeout: 4 * 60_000, intervals: [10_000], message: 'no metrics were written' },
    )
    .toEqual([true, true]);
  await page.goto(`${baseUrl()}${org}/metrics`);
  await expect(page.getByText('Request duration')).toBeVisible();
  await expect(page.getByText('Could not load data')).toHaveCount(0);
  // On the device page the same charts are scoped to it.
  await page.goto(`${baseUrl()}${org}/nodes/${nodeId}`);
  await expect(page.getByText('Metrics', { exact: true }).first()).toBeVisible();

  // The audit log recorded the enrollment (and, further down, the settings change and the restart).
  const audit = async (action: string) =>
    (
      (await (await cp(page, 'GET', `${org}/audit-logs?action=${action}&limit=50`)).json()) as {
        items: { action: string }[];
      }
    ).items.length;
  expect(await audit('node.enroll')).toBeGreaterThan(0);

  if (kind === 'chat') {
    mark('operations: engine overrides');
    // Engine overrides: CPU and a small window. The device reloads the model with them and serves again.
    await page.goto(`${baseUrl()}${org}/nodes/${nodeId}`);
    await page.getByLabel('Compute backend').selectOption('cpu');
    await expect(
      page.getByText('Saved. The device applies it within seconds.').first(),
    ).toBeVisible();
    await page.getByLabel('Maximum context (tokens)').fill('2048');
    await page.getByLabel('Maximum context (tokens)').press('Enter');
    await expect.poll(() => audit('node.update'), { timeout: 30_000 }).toBeGreaterThan(0);
    const node = async () =>
      (await (await cp(page, 'GET', `${org}/nodes/${nodeId}`)).json()) as {
        computeBackend: string | null;
        maxContextTokens: number | null;
        live: { backend: string | null; maxContextTokens: number | null } | null;
      };
    await expect
      .poll(
        async () => {
          const n = await node();
          return [n.computeBackend, n.maxContextTokens, n.live?.backend, n.live?.maxContextTokens];
        },
        {
          timeout: 5 * 60_000,
          intervals: [5_000],
          message: 'the device never applied the override',
        },
      )
      .toEqual(['cpu', 2048, 'cpu', 2048]);
    await page.reload();
    await expect(page.getByLabel('Compute backend')).toHaveValue('cpu');
    await serves(3 * 60_000, 'the device does not serve after the override');
    // Back to "device decides".
    await page.getByLabel('Compute backend').selectOption('');
    await page.getByLabel('Maximum context (tokens)').fill('');
    await page.getByLabel('Maximum context (tokens)').press('Enter');
    await expect.poll(async () => (await node()).maxContextTokens, { timeout: 30_000 }).toBeNull();
    await serves(3 * 60_000, 'the device does not serve after the override was lifted');

    mark('operations: benchmark');
    // Benchmark: the pool's devices are measured one at a time; the result is listed.
    await page.goto(`${baseUrl()}${org}/pools/${poolId}`);
    // The page re-renders while the device reports (a phone does it often), which can detach the button between
    // Playwright's checks: retry the click together with its confirmation.
    await expect(async () => {
      await page.getByRole('button', { name: 'Run benchmark' }).click({ timeout: 5_000 });
      await expect(page.getByText('Benchmark started.').first()).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    // One device in the pool: no "Pool throughput" total (it needs two results), just the device's own row.
    await expect(page.getByText('Done', { exact: true }).first()).toBeVisible({
      timeout: 5 * 60_000,
    });
    await expect(page.getByText('Tokens/sec').first()).toBeVisible();
    await expect(page.getByText('First token').first()).toBeVisible();
    await expect(page.getByText('Failed', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Delete' }).last().click();
  } else {
    // An embedding pool has nothing to generate: the benchmark is refused by the server.
    const res = await cp(page, 'POST', `${org}/pools/${poolId}/benchmarks`);
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  }

  // Remote restart, from the device page: sent, audited, the device goes away and comes back, and serves.
  await page.goto(`${baseUrl()}${org}/nodes/${nodeId}`);
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(page.getByText('Restart sent.').first()).toBeVisible();
  await expect.poll(() => audit('node.restart'), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect
    .poll(async () => (await poolNodes(page, orgId, poolId)).find((n) => n.id === nodeId)?.status, {
      timeout: 10 * 60_000,
      intervals: [5_000],
      message: 'the device did not come back after the restart',
    })
    .toBe('online');
  await serves(5 * 60_000, 'the device does not serve after the restart');
}
