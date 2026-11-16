import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  benchmarkResults,
  configChanges,
  models,
  nodeStatus,
  nodes,
  poolModels,
} from '../db/schema';
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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  user: string,
  payload?: object,
) => t.app.inject({ method, url: `/api${url}`, headers: t.as(user), payload });

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

describe('rate limits', () => {
  it('sets, keeps and clears organisation limits (admins only) and records a config change', async () => {
    const { orgId, member } = await setup('own@l.io', 'lim-org');
    const url = `/organisations/${orgId}`;
    const none = { requestsPerMinute: null, tokensPerMinute: null, tokensPerDay: null };
    expect((await call('GET', url, member)).json().limits).toEqual(none);
    expect((await call('PATCH', url, member, { limits: { tokensPerDay: 5 } })).statusCode).toBe(
      403,
    );

    const before = (await t.db.select().from(configChanges)).length;
    const set = await call('PATCH', url, 'own@l.io', {
      limits: { requestsPerMinute: 60, tokensPerDay: 1_000_000 },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().limits).toEqual({ ...none, requestsPerMinute: 60, tokensPerDay: 1_000_000 });
    expect((await t.db.select().from(configChanges)).length).toBe(before + 1);

    // partial update keeps the others, null clears one
    const part = await call('PATCH', url, 'own@l.io', {
      limits: { tokensPerMinute: 9000, requestsPerMinute: null },
    });
    expect(part.json().limits).toEqual({
      requestsPerMinute: null,
      tokensPerMinute: 9000,
      tokensPerDay: 1_000_000,
    });
    // renaming does not touch limits
    const renamed = await call('PATCH', url, 'own@l.io', { name: 'renamed' });
    expect(renamed.json().limits.tokensPerMinute).toBe(9000);

    for (const bad of [
      { limits: {} },
      { limits: { requestsPerMinute: 0 } },
      { limits: { tokensPerDay: 1.5 } },
    ])
      expect((await call('PATCH', url, 'own@l.io', bad)).statusCode).toBe(400);
  });

  it('sets limits when creating a key and changes them afterwards', async () => {
    const { orgId, member } = await setup('own@lk.io', 'lim-key');
    const base = `/organisations/${orgId}/api-keys`;
    const created = await call('POST', base, 'own@lk.io', {
      name: 'k',
      scope: 'org',
      limits: { requestsPerMinute: 10 },
    });
    expect(created.statusCode).toBe(201);
    const key = created.json().key;
    expect(key.limits).toEqual({
      requestsPerMinute: 10,
      tokensPerMinute: null,
      tokensPerDay: null,
    });

    expect(
      (await call('PATCH', `${base}/${key.id}`, member, { limits: { tokensPerDay: 1 } }))
        .statusCode,
    ).toBe(403);
    const patched = await call('PATCH', `${base}/${key.id}`, 'own@lk.io', {
      limits: { tokensPerDay: 500, requestsPerMinute: null },
    });
    expect(patched.json().limits).toEqual({
      requestsPerMinute: null,
      tokensPerMinute: null,
      tokensPerDay: 500,
    });
    const list = (await call('GET', base, 'own@lk.io')).json();
    expect(list[0].limits.tokensPerDay).toBe(500);
    const other = await setup('own2@lk.io', 'lim-key-2');
    expect(
      (
        await call('PATCH', `/organisations/${other.orgId}/api-keys/${key.id}`, 'own2@lk.io', {
          limits: { tokensPerDay: 1 },
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('benchmarks', () => {
  async function pool(slug: string, online: boolean, withModel = true) {
    const s = await setup(`own@${slug}.io`, slug);
    if (withModel) {
      const [m] = await t.db
        .insert(models)
        .values({
          orgId: s.orgId,
          name: 'm',
          source: 'upload',
          fileName: 'm.litertlm',
          status: 'ready',
          storageKey: 'k',
        })
        .returning();
      await t.db.insert(poolModels).values({ poolId: s.poolId, modelId: m!.id });
    }
    const [node] = await t.db
      .insert(nodes)
      .values({
        orgId: s.orgId,
        poolId: s.poolId,
        name: 'phone',
        publicKey: `b-${slug}`,
        fingerprint: 'F',
      })
      .returning();
    await t.db.insert(nodeStatus).values({ nodeId: node!.id, connected: online });
    return { ...s, owner: `own@${slug}.io`, node: node! };
  }

  it('creates one pending result per online node and derives the status from the results', async () => {
    const p = await pool('bench-a', true);
    const url = `/organisations/${p.orgId}/pools/${p.poolId}/benchmarks`;
    expect((await call('POST', url, p.member)).statusCode).toBe(403);
    const created = await call('POST', url, p.owner);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      status: 'running',
      results: [{ nodeId: p.node.id, nodeName: 'phone', status: 'pending' }],
    });
    // one at a time per pool
    expect((await call('POST', url, p.owner)).statusCode).toBe(409);

    await t.db
      .update(benchmarkResults)
      .set({ status: 'done', ttftMs: 800, totalMs: 5000, tokens: 64, tokensPerSec: 15.2 })
      .where(eq(benchmarkResults.nodeId, p.node.id));
    const list = (await call('GET', url, p.member)).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'done' });
    expect(list[0].results[0]).toMatchObject({ ttftMs: 800, tokensPerSec: 15.2 });

    // a finished one does not block the next
    expect((await call('POST', url, p.owner)).statusCode).toBe(201);
    expect((await call('GET', url, p.member)).json()).toHaveLength(2);
  });

  it('needs a model and an online node, deletes, and is tenant scoped', async () => {
    const noModel = await pool('bench-b', true, false);
    expect(
      (
        await call(
          'POST',
          `/organisations/${noModel.orgId}/pools/${noModel.poolId}/benchmarks`,
          noModel.owner,
        )
      ).statusCode,
    ).toBe(409);
    const offline = await pool('bench-c', false);
    expect(
      (
        await call(
          'POST',
          `/organisations/${offline.orgId}/pools/${offline.poolId}/benchmarks`,
          offline.owner,
        )
      ).statusCode,
    ).toBe(409);

    const p = await pool('bench-d', true);
    const url = `/organisations/${p.orgId}/pools/${p.poolId}/benchmarks`;
    const id = (await call('POST', url, p.owner)).json().id;
    const other = await setup('o@bench-e.io', 'bench-e');
    expect(
      (
        await call(
          'GET',
          `/organisations/${other.orgId}/pools/${p.poolId}/benchmarks`,
          'o@bench-e.io',
        )
      ).statusCode,
    ).toBe(404);
    expect((await call('DELETE', `${url}/${id}`, p.member)).statusCode).toBe(403);
    expect((await call('DELETE', `${url}/${id}`, p.owner)).statusCode).toBe(204);
    expect((await call('DELETE', `${url}/${id}`, p.owner)).statusCode).toBe(404);
  });
});
