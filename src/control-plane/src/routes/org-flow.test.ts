import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usageRecords } from '../db/schema';
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

async function newOrg(owner: string, slug: string) {
  const res = await call('POST', '/organisations', owner, { name: slug, slug });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>().id;
}

describe('organisations', () => {
  it('creates, reads, renames and deletes with role checks', async () => {
    const id = await newOrg('own@x.io', 'acme');
    await call('POST', `/organisations/${id}/members`, 'own@x.io', { email: 'mem@x.io' });

    expect((await call('GET', `/organisations/${id}`, 'own@x.io')).json().role).toBe('owner');
    // non-members cannot tell the organisation exists
    expect((await call('GET', `/organisations/${id}`, 'out@x.io')).statusCode).toBe(404);
    // plain members cannot rename or delete
    expect(
      (await call('PATCH', `/organisations/${id}`, 'mem@x.io', { name: 'n' })).statusCode,
    ).toBe(403);
    expect((await call('DELETE', `/organisations/${id}`, 'mem@x.io')).statusCode).toBe(403);

    const renamed = await call('PATCH', `/organisations/${id}`, 'own@x.io', { name: 'Acme Inc' });
    expect(renamed.json().name).toBe('Acme Inc');
    expect((await call('PATCH', `/organisations/${id}`, 'own@x.io', {})).statusCode).toBe(400);

    await newOrg('own@x.io', 'other');
    const clash = await call('PATCH', `/organisations/${id}`, 'own@x.io', { slug: 'other' });
    expect(clash.statusCode).toBe(409);

    expect((await call('DELETE', `/organisations/${id}`, 'own@x.io')).statusCode).toBe(204);
    expect((await call('GET', `/organisations/${id}`, 'own@x.io')).statusCode).toBe(404);
  });
});

describe('members', () => {
  it('enforces who may manage whom and keeps one owner', async () => {
    const id = await newOrg('o@m.io', 'members-org');
    const m = `/organisations/${id}/members`;
    expect(
      (await call('POST', m, 'o@m.io', { email: 'Admin@M.io', role: 'admin' })).statusCode,
    ).toBe(201);
    expect((await call('POST', m, 'o@m.io', { email: 'admin@m.io' })).statusCode).toBe(409);
    await call('POST', m, 'o@m.io', { email: 'plain@m.io' });

    // admin: may add members, not admins/owners, and cannot touch admins/owners
    expect((await call('POST', m, 'admin@m.io', { email: 'new@m.io' })).statusCode).toBe(201);
    expect(
      (await call('POST', m, 'admin@m.io', { email: 'x@m.io', role: 'admin' })).statusCode,
    ).toBe(403);
    expect((await call('PATCH', `${m}/o@m.io`, 'admin@m.io', { role: 'member' })).statusCode).toBe(
      403,
    );
    expect((await call('DELETE', `${m}/o@m.io`, 'admin@m.io')).statusCode).toBe(403);
    // members cannot manage anyone
    expect((await call('POST', m, 'plain@m.io', { email: 'y@m.io' })).statusCode).toBe(403);
    expect((await call('DELETE', `${m}/new@m.io`, 'plain@m.io')).statusCode).toBe(403);

    // last owner is protected, in every way
    expect((await call('PATCH', `${m}/o@m.io`, 'o@m.io', { role: 'admin' })).statusCode).toBe(409);
    expect((await call('DELETE', `${m}/o@m.io`, 'o@m.io')).statusCode).toBe(409);
    // with a second owner the first may step down
    await call('PATCH', `${m}/admin@m.io`, 'o@m.io', { role: 'owner' });
    expect((await call('PATCH', `${m}/o@m.io`, 'admin@m.io', { role: 'member' })).statusCode).toBe(
      200,
    );

    // anyone may leave; the email path segment is case-insensitive
    expect((await call('DELETE', `${m}/PLAIN@m.io`, 'plain@m.io')).statusCode).toBe(204);
    expect((await call('GET', m, 'plain@m.io')).statusCode).toBe(404);
    const list = (await call('GET', m, 'admin@m.io')).json<{ email: string; role: string }[]>();
    expect(list.map((x) => x.email).sort()).toEqual(['admin@m.io', 'new@m.io', 'o@m.io']);
  });
});

describe('pools', () => {
  it('covers crud, roles and tenant isolation', async () => {
    const a = await newOrg('a@p.io', 'pools-a');
    const b = await newOrg('b@p.io', 'pools-b');
    await call('POST', `/organisations/${a}/members`, 'a@p.io', { email: 'mem@p.io' });

    const created = await call('POST', `/organisations/${a}/pools`, 'a@p.io', { name: 'edge' });
    expect(created.statusCode).toBe(201);
    const poolId = created.json<{ id: string }>().id;
    const url = `/organisations/${a}/pools/${poolId}`;

    expect((await call('GET', url, 'mem@p.io')).statusCode).toBe(200);
    expect((await call('PATCH', url, 'mem@p.io', { name: 'x' })).statusCode).toBe(403);
    expect((await call('DELETE', url, 'mem@p.io')).statusCode).toBe(403);

    const patched = await call('PATCH', url, 'a@p.io', { requireApproval: true });
    expect(patched.json()).toMatchObject({ name: 'edge', requireApproval: true });
    await call('POST', `/organisations/${a}/pools`, 'a@p.io', { name: 'second' });
    expect((await call('PATCH', url, 'a@p.io', { name: 'second' })).statusCode).toBe(409);

    // another organisation cannot reach it, even through its own org path
    expect((await call('GET', url, 'b@p.io')).statusCode).toBe(404);
    expect((await call('GET', `/organisations/${b}/pools/${poolId}`, 'b@p.io')).statusCode).toBe(
      404,
    );
    expect((await call('DELETE', `/organisations/${b}/pools/${poolId}`, 'b@p.io')).statusCode).toBe(
      404,
    );

    expect((await call('DELETE', url, 'a@p.io')).statusCode).toBe(204);
    expect((await call('GET', url, 'a@p.io')).statusCode).toBe(404);
  });

  it('feeds the gateway: every config change lands in config_changes', async () => {
    const id = await newOrg('c@p.io', 'feed-org');
    const res = await call('POST', `/organisations/${id}/pools`, 'c@p.io', { name: 'p' });
    const poolId = res.json<{ id: string }>().id;
    await call('DELETE', `/organisations/${id}`, 'c@p.io');
    const rows = (await t.db.execute(
      `select entity_type, entity_id from config_changes where org_id = '${id}' order by seq` as never,
    )) as unknown as { rows: { entity_type: string; entity_id: string }[] };
    // org created, pool created, then the cascaded pool and the organisation itself on delete
    expect(rows.rows.map((r) => r.entity_type)).toEqual([
      'organisation',
      'pool',
      'pool',
      'organisation',
    ]);
    expect(rows.rows[2]!.entity_id).toBe(poolId);
  });
});

describe('usage', () => {
  it('aggregates per day, groups, filters and stays tenant scoped', async () => {
    const a = await newOrg('a@u.io', 'usage-a');
    const b = await newOrg('b@u.io', 'usage-b');
    const pool = crypto.randomUUID();
    const key = crypto.randomUUID();
    const now = Date.now();
    const minute = (agoMin: number) =>
      new Date(Math.floor((now - agoMin * 60_000) / 60_000) * 60_000);
    const row = (orgId: string, agoMin: number, model: string, n: number) => ({
      bucket: minute(agoMin),
      orgId,
      poolId: pool,
      keyId: key,
      model,
      tokensIn: 10 * n,
      tokensOut: 20 * n,
      requests: n,
      errors: n - 1,
    });
    await t.db
      .insert(usageRecords)
      .values([row(a, 1, 'm1', 1), row(a, 2, 'm1', 2), row(a, 3, 'm2', 3), row(b, 1, 'm1', 9)]);

    const all = (await call('GET', `/organisations/${a}/usage?granularity=hour`, 'a@u.io')).json();
    expect(all.totals).toEqual({ tokensIn: 60, tokensOut: 120, requests: 6, errors: 3 });

    const byModel = (await call('GET', `/organisations/${a}/usage?groupBy=model`, 'a@u.io')).json();
    const groups = Object.fromEntries(
      byModel.series.map((p: { group: string; requests: number }) => [p.group, p.requests]),
    );
    expect(groups).toEqual({ m1: 3, m2: 3 });

    const filtered = (await call('GET', `/organisations/${a}/usage?model=m2`, 'a@u.io')).json();
    expect(filtered.totals.requests).toBe(3);

    expect((await call('GET', `/organisations/${a}/usage`, 'b@u.io')).statusCode).toBe(404);
    const tooLong = await call(
      'GET',
      `/organisations/${a}/usage?from=2020-01-01T00:00:00Z&to=2021-01-01T00:00:00Z`,
      'a@u.io',
    );
    expect(tooLong.statusCode).toBe(400);
  });
});
