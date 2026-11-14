import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nodeStatus, nodes, models } from '../db/schema';
import { mirrorNext } from '../models/mirror';
import { createTestApp } from '../test/harness';

type T = Awaited<ReturnType<typeof createTestApp>>;
let t: T;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  user: string,
  payload?: object,
) => t.app.inject({ method, url: `/api${url}`, headers: t.as(user), payload });

const MiB = 1024 ** 2;
const putPart = (orgId: string, modelId: string, n: number, bytes: number, user: string) =>
  t.app.inject({
    method: 'PUT',
    url: `/api/organisations/${orgId}/models/${modelId}/parts/${n}`,
    headers: { ...t.as(user), 'content-type': 'application/octet-stream' },
    payload: Buffer.alloc(bytes, 1),
  });

async function setup(owner: string, slug: string) {
  const org = (await call('POST', '/organisations', owner, { name: slug, slug })).json<{
    id: string;
  }>();
  await call('POST', `/organisations/${org.id}/members`, owner, { email: `mem-${slug}@x.io` });
  const pool = (
    await call('POST', `/organisations/${org.id}/pools`, owner, { name: 'edge' })
  ).json<{ id: string }>();
  return { orgId: org.id, poolId: pool.id, member: `mem-${slug}@x.io` };
}

describe('pool settings', () => {
  it('defaults, validates and keeps untouched settings on partial updates', async () => {
    const { orgId, poolId } = await setup('own@s.io', 'settings-org');
    const url = `/organisations/${orgId}/pools/${poolId}`;
    const pool = (await call('GET', url, 'own@s.io')).json();
    expect(pool).toMatchObject({ servingType: 'replicated', balancingType: 'weighted_p2c' });

    const created = await call('POST', `/organisations/${orgId}/pools`, 'own@s.io', {
      name: 'rr',
      balancingType: 'round_robin',
      requireApproval: true,
    });
    expect(created.json()).toMatchObject({ balancingType: 'round_robin', requireApproval: true });

    // changing one field must not reset the others (defaults must not leak into PATCH)
    const patched = await call(
      'PATCH',
      `/organisations/${orgId}/pools/${created.json().id}`,
      'own@s.io',
      {
        name: 'rr2',
      },
    );
    expect(patched.json()).toMatchObject({
      name: 'rr2',
      balancingType: 'round_robin',
      requireApproval: true,
    });
    expect(
      (await call('PATCH', url, 'own@s.io', { balancingType: 'least_in_flight' })).json()
        .balancingType,
    ).toBe('least_in_flight');
    expect((await call('PATCH', url, 'own@s.io', { balancingType: 'nope' })).statusCode).toBe(400);
    expect((await call('PATCH', url, 'own@s.io', { servingType: 'sharded' })).statusCode).toBe(400);
  });
});

describe('nodes', () => {
  it('computes status from approval, connection and freshness, and revokes', async () => {
    const { orgId, poolId, member } = await setup('own@n.io', 'nodes-org');
    const base = { orgId, poolId, fingerprint: 'AB12-CD34' };
    const [pending, online, stale] = await t.db
      .insert(nodes)
      .values([
        { ...base, name: 'pending', publicKey: 'k1', approved: false },
        { ...base, name: 'online', publicKey: 'k2', cpuCores: 8, memoryTotalMb: 8000 },
        { ...base, name: 'stale', publicKey: 'k3' },
      ])
      .returning();
    await t.db.insert(nodeStatus).values([
      {
        nodeId: online!.id,
        connected: true,
        connectedSince: new Date(),
        cpuPercent: 42.5,
        memoryUsedMb: 3000,
        inFlight: 2,
      },
      { nodeId: stale!.id, connected: true, updatedAt: new Date(Date.now() - 10 * 60_000) },
    ]);

    const list = (await call('GET', `/organisations/${orgId}/pools/${poolId}/nodes`, member)).json<
      { name: string; status: string; live: unknown }[]
    >();
    const by = Object.fromEntries(list.map((n) => [n.name, n]));
    expect(by.pending!.status).toBe('pending');
    expect(by.online!.status).toBe('online');
    expect(by.stale!.status).toBe('offline'); // crashed gateway must not look online forever
    expect(by.stale!.live).toBeNull();

    const one = (await call('GET', `/organisations/${orgId}/nodes/${online!.id}`, member)).json();
    expect(one.live).toMatchObject({ cpuPercent: 42.5, memoryUsedMb: 3000, inFlight: 2 });
    expect(one.memoryTotalMb).toBe(8000);

    // members read, admins act
    const url = `/organisations/${orgId}/nodes/${pending!.id}`;
    expect((await call('PATCH', url, member, { approved: true })).statusCode).toBe(403);
    expect(
      (await call('PATCH', url, 'own@n.io', { approved: true, name: 'phone' })).json(),
    ).toMatchObject({
      approved: true,
      name: 'phone',
      status: 'offline',
    });
    expect((await call('PATCH', url, 'own@n.io', { approved: false })).statusCode).toBe(400);
    expect((await call('DELETE', url, member)).statusCode).toBe(403);
    expect((await call('DELETE', url, 'own@n.io')).statusCode).toBe(204);
    expect((await call('GET', url, 'own@n.io')).statusCode).toBe(404);
  });

  it('is invisible to other organisations', async () => {
    const a = await setup('a@n.io', 'iso-a');
    const b = await setup('b@n.io', 'iso-b');
    const [node] = await t.db
      .insert(nodes)
      .values({ orgId: a.orgId, poolId: a.poolId, name: 'n', publicKey: 'iso', fingerprint: 'F' })
      .returning();
    expect(
      (await call('GET', `/organisations/${b.orgId}/nodes/${node!.id}`, 'b@n.io')).statusCode,
    ).toBe(404);
    expect(
      (await call('GET', `/organisations/${a.orgId}/nodes/${node!.id}`, 'b@n.io')).statusCode,
    ).toBe(404);
    expect(
      (await call('DELETE', `/organisations/${b.orgId}/nodes/${node!.id}`, 'b@n.io')).statusCode,
    ).toBe(404);
    expect(
      (await call('GET', `/organisations/${b.orgId}/pools/${a.poolId}/nodes`, 'b@n.io')).statusCode,
    ).toBe(404);
  });

  it('records node changes when its pool is deleted', async () => {
    const { orgId, poolId } = await setup('own@d.io', 'node-del');
    const [node] = await t.db
      .insert(nodes)
      .values({ orgId, poolId, name: 'n', publicKey: 'del', fingerprint: 'F' })
      .returning();
    await call('DELETE', `/organisations/${orgId}/pools/${poolId}`, 'own@d.io');
    const rows = await t.db.execute(
      `select entity_type from config_changes where entity_id = '${node!.id}'` as never,
    );
    expect((rows as unknown as { rows: unknown[] }).rows).toHaveLength(1);
  });
});

describe('models', () => {
  it('uploads in parts through the control plane and completes', async () => {
    const { orgId, poolId, member } = await setup('own@m.io', 'models-up');
    const size = 20 * MiB;
    const start = (name: string) =>
      call('POST', `/organisations/${orgId}/models/uploads`, 'own@m.io', {
        name,
        fileName: 'gemma.litertlm',
        sizeBytes: size,
      });
    const init = await start('gemma');
    expect(init.statusCode).toBe(201);
    const plan = init.json();
    expect(plan).toMatchObject({ partSize: 8 * MiB, partCount: 3 });
    expect(plan.model.status).toBe('uploading');

    // not assignable before it is ready
    const modelUrl = `/organisations/${orgId}/pools/${poolId}/models/${plan.model.id}`;
    expect((await call('PUT', modelUrl, 'own@m.io')).statusCode).toBe(409);

    // parts are authorised and size-checked
    expect((await putPart(orgId, plan.model.id, 1, 8 * MiB, member)).statusCode).toBe(403);
    expect((await putPart(orgId, plan.model.id, 1, 5 * MiB, 'own@m.io')).statusCode).toBe(400);
    expect((await putPart(orgId, plan.model.id, 3, 8 * MiB, 'own@m.io')).statusCode).toBe(400); // last part is 4 MiB
    expect((await putPart(orgId, plan.model.id, 4, 8 * MiB, 'own@m.io')).statusCode).toBe(404);

    // completing with a missing part fails the upload instead of serving a truncated file
    expect((await putPart(orgId, plan.model.id, 1, 8 * MiB, 'own@m.io')).json()).toEqual({
      etag: '"etag-1"',
    });
    const bad = await call(
      'POST',
      `/organisations/${orgId}/models/${plan.model.id}/complete`,
      'own@m.io',
      { parts: [{ partNumber: 1, etag: 'a' }] },
    );
    expect(bad.statusCode).toBe(409);
    expect(
      (await call('GET', `/organisations/${orgId}/models/${plan.model.id}`, member)).json().status,
    ).toBe('failed');
    expect((await putPart(orgId, plan.model.id, 2, 8 * MiB, 'own@m.io')).statusCode).toBe(409);

    // a good upload
    const ok = (await start('gemma-ok')).json();
    for (const [n, bytes] of [
      [1, 8 * MiB],
      [2, 8 * MiB],
      [3, 4 * MiB],
    ] as const)
      expect((await putPart(orgId, ok.model.id, n, bytes, 'own@m.io')).statusCode).toBe(200);
    const done = await call(
      'POST',
      `/organisations/${orgId}/models/${ok.model.id}/complete`,
      'own@m.io',
      {
        parts: [
          { partNumber: 1, etag: 'a' },
          { partNumber: 2, etag: 'b' },
          { partNumber: 3, etag: 'c' },
        ],
      },
    );
    expect(done.json()).toMatchObject({ status: 'ready', sizeBytes: size });

    // assign to the pool (idempotent), list, unassign
    const assign = `/organisations/${orgId}/pools/${poolId}/models/${ok.model.id}`;
    expect((await call('PUT', assign, member)).statusCode).toBe(403);
    expect((await call('PUT', assign, 'own@m.io')).statusCode).toBe(204);
    expect((await call('PUT', assign, 'own@m.io')).statusCode).toBe(204);
    const served = (
      await call('GET', `/organisations/${orgId}/pools/${poolId}/models`, member)
    ).json();
    expect(served.map((m: { name: string }) => m.name)).toEqual(['gemma-ok']);
    expect((await call('DELETE', assign, 'own@m.io')).statusCode).toBe(204);
    expect((await call('DELETE', assign, 'own@m.io')).statusCode).toBe(204);
  });

  it('validates uploads and names', async () => {
    const { orgId, member } = await setup('own@v.io', 'models-val');
    const up = (body: object, user = 'own@v.io') =>
      call('POST', `/organisations/${orgId}/models/uploads`, user, body);
    const ok = { name: 'a', fileName: 'a.litertlm', sizeBytes: 10 };
    expect((await up({ ...ok, fileName: 'a.bin' })).statusCode).toBe(400);
    expect((await up({ ...ok, fileName: '../a.litertlm' })).statusCode).toBe(400);
    expect((await up({ ...ok, sizeBytes: 64 * 1024 ** 3 })).statusCode).toBe(400);
    expect((await up(ok, member)).statusCode).toBe(403);
    expect((await up(ok)).statusCode).toBe(201);
    expect((await up(ok)).statusCode).toBe(409); // name taken
  });

  it('only accepts Hugging Face model urls', async () => {
    const { orgId } = await setup('own@u.io', 'models-url');
    const add = (url: string) =>
      call('POST', `/organisations/${orgId}/models/from-url`, 'own@u.io', {
        name: `m-${Math.random()}`,
        url,
      });
    expect((await add('https://evil.com/a/b/resolve/main/m.litertlm')).statusCode).toBe(400);
    expect((await add('http://huggingface.co/a/b/resolve/main/m.litertlm')).statusCode).toBe(400);
    expect(
      (await add('https://huggingface.co.evil.com/a/b/resolve/main/m.litertlm')).statusCode,
    ).toBe(400);
    expect((await add('https://huggingface.co/a/b/resolve/main/model.bin')).statusCode).toBe(400);
    const ok = await add('https://huggingface.co/a/b/blob/main/m.litertlm');
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({
      status: 'pending',
      sourceUrl: 'https://huggingface.co/a/b/resolve/main/m.litertlm',
      fileName: 'm.litertlm',
    });
  });

  it('mirrors a Hugging Face file into storage, following CDN redirects safely', async () => {
    await t.db.delete(models); // the worker takes the oldest pending model: start clean
    const { orgId, poolId } = await setup('own@h.io', 'models-hf');
    const created = (
      await call('POST', `/organisations/${orgId}/models/from-url`, 'own@h.io', {
        name: 'mirrored',
        url: 'https://huggingface.co/a/b/resolve/main/m.litertlm',
      })
    ).json();
    const seen: { url: string; auth: string | null }[] = [];
    const body = Buffer.from('hello model');
    const fakeFetch = (async (input: URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(input), auth: headers.get('authorization') });
      if (input.hostname === 'huggingface.co')
        return new Response(null, {
          status: 302,
          headers: { location: 'https://cdn-lfs.hf.co/x' },
        });
      return new Response(body, { headers: { 'content-length': String(body.length) } });
    }) as unknown as typeof fetch;

    expect(
      await mirrorNext({ db: t.db, storage: t.storage!, hfToken: 'secret', fetch: fakeFetch }),
    ).toBe(true);
    // token goes to huggingface.co only, never to the CDN
    expect(seen).toEqual([
      { url: 'https://huggingface.co/a/b/resolve/main/m.litertlm', auth: 'Bearer secret' },
      { url: 'https://cdn-lfs.hf.co/x', auth: null },
    ]);
    const m = (
      await call('GET', `/organisations/${orgId}/models/${created.id}`, 'own@h.io')
    ).json();
    expect(m).toMatchObject({
      status: 'ready',
      sizeBytes: body.length,
      progressBytes: body.length,
    });
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(t.storage!.objects.get(`orgs/${orgId}/models/${created.id}/m.litertlm`)).toBe(
      body.length,
    );
    expect(await mirrorNext({ db: t.db, storage: t.storage!, fetch: fakeFetch })).toBe(false);

    // assignable now
    expect(
      (
        await call(
          'PUT',
          `/organisations/${orgId}/pools/${poolId}/models/${created.id}`,
          'own@h.io',
        )
      ).statusCode,
    ).toBe(204);
  });

  it('refuses redirects off Hugging Face and marks the model failed, retryable', async () => {
    await t.db.delete(models);
    const { orgId } = await setup('own@r.io', 'models-fail');
    const created = (
      await call('POST', `/organisations/${orgId}/models/from-url`, 'own@r.io', {
        name: 'evil-redirect',
        url: 'https://huggingface.co/a/b/resolve/main/x.litertlm',
      })
    ).json();
    const evil = (async (input: URL) =>
      input.hostname === 'huggingface.co'
        ? new Response(null, {
            status: 302,
            headers: { location: 'http://169.254.169.254/latest' },
          })
        : new Response('leak')) as unknown as typeof fetch;
    await mirrorNext({ db: t.db, storage: t.storage!, fetch: evil });
    const failed = (
      await call('GET', `/organisations/${orgId}/models/${created.id}`, 'own@r.io')
    ).json();
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('Refusing');

    const retried = await call(
      'POST',
      `/organisations/${orgId}/models/${created.id}/retry`,
      'own@r.io',
    );
    expect(retried.json().status).toBe('pending');
    expect(
      (await call('POST', `/organisations/${orgId}/models/${created.id}/retry`, 'own@r.io'))
        .statusCode,
    ).toBe(409);
    await t.db.delete(models); // keep later tests independent of the pending row
  });

  it('deleting a model removes its file and tells the pools serving it', async () => {
    const { orgId, poolId } = await setup('own@x.io', 'models-del');
    const init = (
      await call('POST', `/organisations/${orgId}/models/uploads`, 'own@x.io', {
        name: 'gone',
        fileName: 'g.litertlm',
        sizeBytes: 5,
      })
    ).json();
    const key = `orgs/${orgId}/models/${init.model.id}/g.litertlm`;
    await putPart(orgId, init.model.id, 1, 5, 'own@x.io');
    await call('POST', `/organisations/${orgId}/models/${init.model.id}/complete`, 'own@x.io', {
      parts: [{ partNumber: 1, etag: 'a' }],
    });
    await call(
      'PUT',
      `/organisations/${orgId}/pools/${poolId}/models/${init.model.id}`,
      'own@x.io',
    );
    expect(t.storage!.objects.has(key)).toBe(true);

    expect(
      (await call('DELETE', `/organisations/${orgId}/models/${init.model.id}`, 'own@x.io'))
        .statusCode,
    ).toBe(204);
    expect(t.storage!.objects.has(key)).toBe(false);
    const rows = (await t.db.execute(
      `select entity_type from config_changes where org_id = '${orgId}' order by seq desc limit 2` as never,
    )) as unknown as { rows: { entity_type: string }[] };
    expect(rows.rows.map((r) => r.entity_type).sort()).toEqual(['model', 'pool']);
  });

  it('answers 503 when storage is not configured', async () => {
    const bare = await createTestApp({ withStorage: false });
    const org = (
      await bare.app.inject({
        method: 'POST',
        url: '/api/organisations',
        headers: bare.as('o@z.io'),
        payload: { name: 'z', slug: 'zz' },
      })
    ).json<{ id: string }>();
    const res = await bare.app.inject({
      method: 'POST',
      url: `/api/organisations/${org.id}/models/uploads`,
      headers: bare.as('o@z.io'),
      payload: { name: 'a', fileName: 'a.litertlm', sizeBytes: 1 },
    });
    expect(res.statusCode).toBe(503);
    expect(
      (
        await bare.app.inject({
          url: `/api/organisations/${org.id}/models`,
          headers: bare.as('o@z.io'),
        })
      ).statusCode,
    ).toBe(200);
    await bare.close();
  });
});
