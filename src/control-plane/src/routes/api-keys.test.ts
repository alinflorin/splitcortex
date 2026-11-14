import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { apiKeyPools, apiKeys, configChanges } from '../db/schema';
import { createTestApp } from '../test/harness';
import { hashApiKey } from './api-keys';

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

async function setup(slug: string) {
  const org = (await call('POST', '/organisations', 'own@k.io', { name: slug, slug })).json<{
    id: string;
  }>().id;
  await call('POST', `/organisations/${org}/members`, 'own@k.io', {
    email: 'adm@k.io',
    role: 'admin',
  });
  await call('POST', `/organisations/${org}/members`, 'own@k.io', { email: 'mem@k.io' });
  const pool = async (name: string) =>
    (await call('POST', `/organisations/${org}/pools`, 'own@k.io', { name })).json<{ id: string }>()
      .id;
  return { org, a: await pool('a'), b: await pool('b') };
}

describe('api keys', () => {
  it('creates org-wide and pool-scoped keys, storing only the hash', async () => {
    const { org, a, b } = await setup('keys-1');
    const url = `/organisations/${org}/api-keys`;

    const all = await call('POST', url, 'adm@k.io', { name: 'ci', scope: 'org' });
    expect(all.statusCode).toBe(201);
    const { key, secret } = all.json();
    expect(secret).toMatch(/^sc_[A-Za-z0-9_-]{43}$/);
    expect(key).toMatchObject({ allPools: true, poolIds: [], createdBy: 'adm@k.io' });
    expect(key.prefix).toBe(secret.slice(0, 10));
    expect(JSON.stringify(key)).not.toContain(secret);

    const [row] = await t.db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
    expect(row!.hash).toBe(hashApiKey(secret));
    expect(row!.hash).not.toContain(secret);

    const some = await call('POST', url, 'own@k.io', {
      name: 'two pools',
      scope: 'pools',
      poolIds: [a, b, a],
    });
    expect(some.statusCode).toBe(201);
    expect(some.json().key.poolIds.sort()).toEqual([a, b].sort());

    const list = (await call('GET', url, 'adm@k.io')).json<{ id: string; poolIds: string[] }[]>();
    expect(list).toHaveLength(2);
    expect(JSON.stringify(list)).not.toContain(secret);
    expect(list.find((k) => k.id === some.json().key.id)!.poolIds).toHaveLength(2);

    const changes = await t.db
      .select()
      .from(configChanges)
      .where(eq(configChanges.entityType, 'api_key'));
    expect(changes.length).toBeGreaterThanOrEqual(2);
  });

  it('validates scope, pools and expiry', async () => {
    const { org, a } = await setup('keys-2');
    const other = await setup('keys-3');
    const url = `/organisations/${org}/api-keys`;
    const post = (body: object) => call('POST', url, 'own@k.io', body);
    expect((await post({ name: 'x', scope: 'pools' })).statusCode).toBe(400);
    expect((await post({ name: 'x', scope: 'pools', poolIds: [other.a] })).statusCode).toBe(400);
    expect(
      (await post({ name: 'x', scope: 'org', expiresAt: '2020-01-01T00:00:00.000Z' })).statusCode,
    ).toBe(400);
    expect((await post({ name: '', scope: 'org' })).statusCode).toBe(400);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const ok = await post({ name: 'x', scope: 'pools', poolIds: [a], expiresAt: future });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().key.expiresAt).toBe(future);
  });

  it('is admin-only and tenant-scoped', async () => {
    const { org } = await setup('keys-4');
    const url = `/organisations/${org}/api-keys`;
    expect((await call('GET', url, 'mem@k.io')).statusCode).toBe(403);
    expect((await call('POST', url, 'mem@k.io', { name: 'x', scope: 'org' })).statusCode).toBe(403);
    expect((await call('GET', url, 'out@k.io')).statusCode).toBe(404);
    const created = (await call('POST', url, 'own@k.io', { name: 'x', scope: 'org' })).json();
    expect((await call('DELETE', `${url}/${created.key.id}`, 'mem@k.io')).statusCode).toBe(403);
    const elsewhere = await setup('keys-5');
    expect(
      (
        await call(
          'DELETE',
          `/organisations/${elsewhere.org}/api-keys/${created.key.id}`,
          'own@k.io',
        )
      ).statusCode,
    ).toBe(404);
  });

  it('revokes softly and idempotently', async () => {
    const { org } = await setup('keys-6');
    const url = `/organisations/${org}/api-keys`;
    const { key } = (await call('POST', url, 'own@k.io', { name: 'x', scope: 'org' })).json();
    expect((await call('DELETE', `${url}/${key.id}`, 'adm@k.io')).statusCode).toBe(204);
    const before = await t.db.select().from(configChanges);
    expect((await call('DELETE', `${url}/${key.id}`, 'adm@k.io')).statusCode).toBe(204);
    expect(await t.db.select().from(configChanges)).toHaveLength(before.length);
    const [listed] = (await call('GET', url, 'adm@k.io')).json();
    expect(listed.revokedAt).not.toBeNull();
    expect((await call('DELETE', `${url}/${crypto.randomUUID()}`, 'adm@k.io')).statusCode).toBe(
      404,
    );
  });

  it('drops a deleted pool from key scopes and records the change', async () => {
    const { org, a, b } = await setup('keys-7');
    const url = `/organisations/${org}/api-keys`;
    const { key } = (
      await call('POST', url, 'own@k.io', { name: 'x', scope: 'pools', poolIds: [a, b] })
    ).json();
    const before = (await t.db.select().from(configChanges)).length;
    expect((await call('DELETE', `/organisations/${org}/pools/${a}`, 'own@k.io')).statusCode).toBe(
      204,
    );
    const [listed] = (await call('GET', url, 'own@k.io')).json();
    expect(listed.poolIds).toEqual([b]);
    const after = await t.db.select().from(configChanges);
    expect(
      after.slice(before).some((c) => c.entityType === 'api_key' && c.entityId === key.id),
    ).toBe(true);
    // deleting the organisation removes keys and their pool links
    expect((await call('DELETE', `/organisations/${org}`, 'own@k.io')).statusCode).toBe(204);
    expect(await t.db.select().from(apiKeyPools).where(eq(apiKeyPools.keyId, key.id))).toHaveLength(
      0,
    );
  });
});
