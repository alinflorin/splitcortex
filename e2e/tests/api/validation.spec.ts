import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createWorkspace, type Workspace } from '../../src/api.ts';
import { apiUrl } from '../../src/env.ts';

// The control plane's rules, through the real API: input validation, conflicts, secrets, cleanup. No node needed.
test.describe.configure({ mode: 'serial' });

let ws: Workspace;
test.beforeAll(async () => {
  ws = await createWorkspace();
});
test.afterAll(async () => {
  await ws?.cleanup();
});

const keys = () => `/organisations/${ws.org.id}/api-keys`;

test('a model must be a .litertlm file from Hugging Face', async () => {
  const add = (url: string) =>
    ws.cp.send('POST', `/organisations/${ws.org.id}/models/from-url`, { name: 'bad', url });
  expect((await add('https://example.com/model.litertlm')).status).toBe(400);
  expect((await add('https://huggingface.co/x/y/resolve/main/model.gguf')).status).toBe(400);
  expect((await add('http://huggingface.co/x/y/resolve/main/model.litertlm')).status).toBe(400);
  const upload = await ws.cp.send('POST', `/organisations/${ws.org.id}/models/uploads`, {
    name: 'bad',
    fileName: 'model.bin',
    sizeBytes: 10,
  });
  expect(upload.status).toBe(400);
});

test('API key input is validated', async () => {
  expect(
    (await ws.cp.send('POST', keys(), { name: 'k', scope: 'pools', poolIds: [] })).status,
  ).toBe(400);
  const past = new Date(Date.now() - 60_000).toISOString();
  expect(
    (await ws.cp.send('POST', keys(), { name: 'k', scope: 'org', expiresAt: past })).status,
  ).toBe(400);
  const unknownPool = '00000000-0000-4000-8000-000000000000';
  expect(
    (await ws.cp.send('POST', keys(), { name: 'k', scope: 'pools', poolIds: [unknownPool] }))
      .status,
  ).toBe(400);
  expect(
    (
      await ws.cp.send('POST', keys(), {
        name: 'k',
        scope: 'org',
        limits: { requestsPerMinute: 0 },
      })
    ).status,
  ).toBe(400);
});

test('the secret of a key is returned once and only its hash is kept', async () => {
  const key = await ws.apiKey();
  expect(key.secret).toMatch(/^sc_/);
  const listed = await ws.cp.send('GET', keys());
  expect(listed.status).toBe(200);
  const text = JSON.stringify(listed.body);
  expect(text).toContain(key.id);
  expect(text).not.toContain(key.secret);
});

test('revoking a key twice is harmless', async () => {
  const key = await ws.apiKey();
  await ws.cp.revokeApiKey(ws.org.id, key.id);
  await ws.cp.revokeApiKey(ws.org.id, key.id);
});

test('names and slugs are unique', async () => {
  const pool = await ws.cp.send('POST', `/organisations/${ws.org.id}/pools`, {
    name: ws.pool.name,
  });
  expect(pool.status).toBe(409);
  const dup = await ws.cp.send('POST', '/organisations', {
    name: 'Duplicate',
    slug: ws.org.slug,
  });
  expect(dup.status).toBe(409);
});

test('requests without a valid token are refused', async () => {
  const res = await fetch(`${apiUrl}/organisations`, {
    headers: { authorization: `Bearer ${randomBytes(24).toString('hex')}` },
  });
  expect(res.status).toBe(401);
});

test('deleting an organisation removes it with its pools and keys', async () => {
  const other = await ws.cp.createOrg();
  const pool = await ws.cp.createPool(other.id);
  await ws.cp.createApiKey(other.id);
  await ws.cp.deleteOrg(other.id);
  expect((await ws.cp.send('GET', `/organisations/${other.id}`)).status).not.toBe(200);
  expect((await ws.cp.send('GET', `/organisations/${other.id}/pools/${pool.id}`)).status).not.toBe(
    200,
  );
  expect((await ws.cp.listOrgs()).map((o) => o.id)).not.toContain(other.id);
});
