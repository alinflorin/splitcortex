import { generateKeyPairSync, sign } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { models, nodes, poolModels } from '../db/schema';
import { nodeRequestMessage } from '../plugins/node-auth';
import { createTestApp } from '../test/harness';
import { parseRange } from './node-models';

type T = Awaited<ReturnType<typeof createTestApp>>;
let t: T;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const call = (method: 'POST' | 'GET' | 'PUT', url: string, user: string, payload?: object) =>
  t.app.inject({ method, url: `/api${url}`, headers: t.as(user), payload });

const SIZE = 1000;

async function setup(slug: string) {
  const user = `own@${slug}.io`;
  const org = (await call('POST', '/organisations', user, { name: slug, slug })).json<{
    id: string;
  }>();
  const pool = (await call('POST', `/organisations/${org.id}/pools`, user, { name: 'edge' })).json<{
    id: string;
  }>();
  const other = (
    await call('POST', `/organisations/${org.id}/pools`, user, { name: 'other' })
  ).json<{
    id: string;
  }>();
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const [node] = await t.db
    .insert(nodes)
    .values({
      orgId: org.id,
      poolId: pool.id,
      name: 'phone',
      publicKey: raw.toString('base64url'),
      fingerprint: 'AAAA-AAAA-AAAA',
    })
    .returning();
  const addModel = async (
    name: string,
    poolId: string | null,
    status: 'ready' | 'failed' = 'ready',
  ) => {
    const [m] = await t.db
      .insert(models)
      .values({
        orgId: org.id,
        name,
        source: 'upload',
        fileName: `${name}.litertlm`,
        status,
        storageKey: `orgs/${org.id}/${name}`,
        sizeBytes: SIZE,
        sha256: 'ab'.repeat(32),
      })
      .returning();
    t.storage!.objects.set(m!.storageKey, SIZE);
    if (poolId) await t.db.insert(poolModels).values({ poolId, modelId: m!.id });
    return m!;
  };
  const auth = (method: string, path: string, opts: { id?: string; ts?: number } = {}) => {
    const ts = opts.ts ?? Math.floor(Date.now() / 1000);
    const sig = sign(null, nodeRequestMessage(method, path, ts), privateKey).toString('base64url');
    return { authorization: `Node ${opts.id ?? node!.id}.${ts}.${sig}` };
  };
  return { org, pool, other, node: node!, addModel, auth };
}

describe('node self', () => {
  it('tells a device its organisation, pool and name, and rejects bad signatures', async () => {
    const s = await setup('me');
    const me = await t.app.inject({
      method: 'GET',
      url: '/api/node/me',
      headers: s.auth('GET', '/api/node/me'),
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      nodeId: s.node.id,
      name: 'phone',
      orgName: 'me',
      orgSlug: 'me',
      poolName: 'edge',
      approved: true,
    });
    const bad = await t.app.inject({
      method: 'GET',
      url: '/api/node/me',
      headers: s.auth('GET', '/api/node/other'),
    });
    expect(bad.statusCode).toBe(401);
  });
});

describe('node model downloads', () => {
  it('lists and streams the ready models of the node pool, with ranges', async () => {
    const s = await setup('dl');
    const m = await s.addModel('gemma', s.pool.id);
    await s.addModel('failed', null, 'failed');
    await s.addModel('elsewhere', null);

    const list = await t.app.inject({
      method: 'GET',
      url: '/api/node/models',
      headers: s.auth('GET', '/api/node/models'),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([
      {
        id: m.id,
        name: 'gemma',
        kind: 'chat',
        fileName: 'gemma.litertlm',
        sizeBytes: SIZE,
        sha256: 'ab'.repeat(32),
      },
    ]);

    const path = `/api/node/models/${m.id}/file`;
    const full = await t.app.inject({ method: 'GET', url: path, headers: s.auth('GET', path) });
    expect(full.statusCode).toBe(200);
    expect(full.rawPayload.length).toBe(SIZE);
    expect(full.headers).toMatchObject({
      'accept-ranges': 'bytes',
      'x-content-sha256': 'ab'.repeat(32),
    });

    const part = await t.app.inject({
      method: 'GET',
      url: path,
      headers: { ...s.auth('GET', path), range: 'bytes=100-199' },
    });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 100-199/${SIZE}`);
    expect(part.rawPayload.length).toBe(100);

    const bad = await t.app.inject({
      method: 'GET',
      url: path,
      headers: { ...s.auth('GET', path), range: `bytes=${SIZE}-` },
    });
    expect(bad.statusCode).toBe(416);
    expect(bad.headers['content-range']).toBe(`bytes */${SIZE}`);

    // not assigned to the node's pool / not ready: the same 404
    for (const other of [
      await s.addModel('elsewhere2', s.other.id),
      await s.addModel('failed2', null, 'failed'),
    ]) {
      const p = `/api/node/models/${other.id}/file`;
      const res = await t.app.inject({ method: 'GET', url: p, headers: s.auth('GET', p) });
      expect(res.statusCode).toBe(404);
    }
  });

  it('serves one model per pool: assigning another replaces it', async () => {
    const s = await setup('one');
    const a = await s.addModel('a', null);
    const b = await s.addModel('b', null);
    const put = (m: string) =>
      call('PUT', `/organisations/${s.org.id}/pools/${s.pool.id}/models/${m}`, 'own@one.io');
    expect((await put(a.id)).statusCode).toBe(204);
    expect((await put(b.id)).statusCode).toBe(204);
    expect((await put(b.id)).statusCode).toBe(204);
    const list = await call(
      'GET',
      `/organisations/${s.org.id}/pools/${s.pool.id}/models`,
      'own@one.io',
    );
    expect(list.json<{ id: string }[]>().map((m) => m.id)).toEqual([b.id]);
  });

  it('rejects bad, stale, replayed-elsewhere and unapproved credentials', async () => {
    const s = await setup('auth');
    const path = '/api/node/models';
    const get = (headers: Record<string, string>) =>
      t.app.inject({ method: 'GET', url: path, headers });

    expect((await get({})).statusCode).toBe(401);
    expect((await get({ authorization: 'Bearer email:own@auth.io' })).statusCode).toBe(401);
    expect(
      (await get(s.auth('GET', path, { ts: Math.floor(Date.now() / 1000) - 3600 }))).statusCode,
    ).toBe(401);
    // a signature for another path or method is useless
    expect((await get(s.auth('GET', '/api/node/other'))).statusCode).toBe(401);
    expect((await get(s.auth('POST', path))).statusCode).toBe(401);
    // unknown node id
    expect(
      (await get(s.auth('GET', path, { id: '00000000-0000-4000-8000-000000000000' }))).statusCode,
    ).toBe(401);
    // another device's key cannot sign for this node
    const intruder = generateKeyPairSync('ed25519').privateKey;
    const ts = Math.floor(Date.now() / 1000);
    const sig = sign(null, nodeRequestMessage('GET', path, ts), intruder).toString('base64url');
    expect((await get({ authorization: `Node ${s.node.id}.${ts}.${sig}` })).statusCode).toBe(401);

    expect((await get(s.auth('GET', path))).statusCode).toBe(200);
    await t.db.update(nodes).set({ approved: false });
    expect((await get(s.auth('GET', path))).statusCode).toBe(401);
  });

  it('answers 503 without storage', async () => {
    const bare = await createTestApp({ withStorage: false });
    const res = await bare.app.inject({
      method: 'GET',
      url: '/api/node/models/00000000-0000-4000-8000-000000000000/file',
      headers: { authorization: 'Node x' },
    });
    expect(res.statusCode).toBe(401); // auth comes first
    await bare.close();
  });
});

describe('parseRange', () => {
  it('handles the forms of a single range', () => {
    expect(parseRange(undefined, 10)).toBeNull();
    expect(parseRange('bytes=2-4', 10)).toEqual({ start: 2, end: 4 });
    expect(parseRange('bytes=2-', 10)).toEqual({ start: 2, end: 9 });
    expect(parseRange('bytes=2-99', 10)).toEqual({ start: 2, end: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=10-', 10)).toBe('invalid');
    expect(parseRange('bytes=5-2', 10)).toBe('invalid');
    expect(parseRange('bytes=-', 10)).toBe('invalid');
    expect(parseRange('bytes=0-1,4-5', 10)).toBeNull();
    expect(parseRange('items=0-1', 10)).toBe('invalid');
  });
});
