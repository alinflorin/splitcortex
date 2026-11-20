import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs } from '../db/schema';
import { recordAudit } from '../db/audit';
import { pruneAuditLogs } from '../db/audit-prune';
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

interface Page {
  items: {
    action: string;
    actorId: string | null;
    outcome: string;
    entityId: string | null;
    metadata: Record<string, unknown> | null;
  }[];
  nextCursor: string | null;
}
const logs = async (orgId: string, user: string, query = '') => {
  const res = await call('GET', `/organisations/${orgId}/audit-logs${query}`, user);
  expect(res.statusCode).toBe(200);
  return res.json<Page>();
};

describe('audit logs', () => {
  it('records mutations, denied attempts and nothing for reads', async () => {
    const org = (
      await call('POST', '/organisations', 'own@a.io', { name: 'A', slug: 'aud-a' })
    ).json<{ id: string }>().id;
    await call('POST', `/organisations/${org}/members`, 'own@a.io', {
      email: 'mem@a.io',
      role: 'member',
    });
    const pool = (
      await call('POST', `/organisations/${org}/pools`, 'own@a.io', { name: 'p1' })
    ).json<{ id: string }>().id;
    await call('GET', `/organisations/${org}/pools`, 'own@a.io');
    // a plain member trying to rename the pool is denied, and that is logged
    expect(
      (await call('PATCH', `/organisations/${org}/pools/${pool}`, 'mem@a.io', { name: 'x' }))
        .statusCode,
    ).toBe(403);
    await call('PATCH', `/organisations/${org}/pools/${pool}`, 'own@a.io', { name: 'p2' });

    const page = await logs(org, 'own@a.io');
    expect(page.items.map((i) => `${i.action}:${i.outcome}`)).toEqual([
      'pool.update:success',
      'pool.update:denied',
      'pool.create:success',
      'member.add:success',
      'organisation.create:success',
    ]);
    const update = page.items[0]!;
    expect(update.actorId).toBe('own@a.io');
    expect(update.entityId).toBe(pool);
    expect(update.metadata).toEqual({ changes: { name: 'p2' } });
    expect(page.items[3]!.entityId).toBe('mem@a.io');
  });

  it('is for admins only and isolated per organisation', async () => {
    const a = (
      await call('POST', '/organisations', 'own@b.io', { name: 'B', slug: 'aud-b' })
    ).json<{ id: string }>().id;
    await call('POST', '/organisations', 'other@b.io', { name: 'C', slug: 'aud-c' });
    await call('POST', `/organisations/${a}/members`, 'own@b.io', {
      email: 'mem@b.io',
      role: 'member',
    });
    await call('POST', `/organisations/${a}/members`, 'own@b.io', {
      email: 'adm@b.io',
      role: 'admin',
    });

    expect((await call('GET', `/organisations/${a}/audit-logs`, 'mem@b.io')).statusCode).toBe(403);
    expect((await call('GET', `/organisations/${a}/audit-logs`, 'out@b.io')).statusCode).toBe(404);
    expect((await call('GET', `/organisations/${a}/audit-logs`, 'adm@b.io')).statusCode).toBe(200);
    // other@b.io's organisation events never show up in A
    expect((await logs(a, 'own@b.io')).items.every((i) => i.actorId !== 'other@b.io')).toBe(true);
    // a non-member's attempt on someone else's organisation is not logged (404 reveals nothing)
    await call('PATCH', `/organisations/${a}`, 'out@b.io', { name: 'hack' });
    expect((await logs(a, 'own@b.io')).items.some((i) => i.actorId === 'out@b.io')).toBe(false);
  });

  it('filters and pages with a cursor', async () => {
    const org = (
      await call('POST', '/organisations', 'own@c.io', { name: 'P', slug: 'aud-p' })
    ).json<{ id: string }>().id;
    for (let i = 0; i < 5; i++)
      await call('POST', `/organisations/${org}/pools`, 'own@c.io', { name: `pool${i}` });

    const first = await logs(org, 'own@c.io', '?limit=2&action=pool.');
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await logs(org, 'own@c.io', `?limit=10&action=pool.&cursor=${first.nextCursor}`);
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((i) => i.metadata);
    expect(all).toHaveLength(5);
    expect(
      (await call('GET', `/organisations/${org}/audit-logs?cursor=garbage`, 'own@c.io')).statusCode,
    ).toBe(400);
  });

  it('exports the filtered log as CSV or JSON, across batches, for admins only', async () => {
    const org = (
      await call('POST', '/organisations', 'own@e.io', { name: 'E', slug: 'aud-e' })
    ).json<{ id: string }>().id;
    await call('POST', `/organisations/${org}/members`, 'own@e.io', {
      email: 'mem@e.io',
      role: 'member',
    });
    const base = Date.now() - 3_600_000;
    await t.db.insert(auditLogs).values(
      Array.from({ length: 2100 }, (_, i) => ({
        orgId: org,
        source: 'gateway',
        actorType: 'system',
        actorId: i === 0 ? '=HYPERLINK("x")' : null,
        action: 'limit.reached',
        outcome: 'denied',
        occurredAt: new Date(base + i),
        metadata: { n: i },
      })),
    );

    const url = `/organisations/${org}/audit-logs/export`;
    const csv = await call('GET', `${url}?action=limit.`, 'own@e.io');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toMatch(/attachment; filename="audit-log-.*\.csv"/);
    const lines = csv.body.trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'occurredAt,source,actorType,actorId,action,entityType,entityId,outcome,ip,metadata',
    );
    expect(lines).toHaveLength(2101); // header + every row, more than one batch
    // spreadsheet formulas are neutralised
    expect(csv.body).toContain(`"'=HYPERLINK(""x"")"`);

    const json = await call('GET', `${url}?format=json&action=limit.&outcome=denied`, 'own@e.io');
    const rows = JSON.parse(json.body) as { occurredAt: string; metadata: { n: number } }[];
    expect(rows).toHaveLength(2100);
    expect(rows[0]!.metadata.n).toBe(2099); // newest first
    expect(
      JSON.parse((await call('GET', `${url}?format=json&action=nothing.`, 'own@e.io')).body),
    ).toEqual([]);

    expect((await call('GET', url, 'mem@e.io')).statusCode).toBe(403);
    expect((await call('GET', url, 'out@e.io')).statusCode).toBe(404);
  });

  it('prunes rows past the retention window', async () => {
    const org = (
      await call('POST', '/organisations', 'own@d.io', { name: 'D', slug: 'aud-d' })
    ).json<{ id: string }>().id;
    await recordAudit(t.db, {
      orgId: org,
      actorType: 'system',
      action: 'old.event',
      source: 'gateway',
    });
    await t.db
      .update(auditLogs)
      .set({ occurredAt: new Date(Date.now() - 100 * 86_400_000) })
      .where((await import('drizzle-orm')).eq(auditLogs.action, 'old.event'));
    expect(await pruneAuditLogs({ db: t.db, retentionDays: 90 })).toBe(1);
    expect((await logs(org, 'own@d.io')).items.some((i) => i.action === 'old.event')).toBe(false);
  });
});
