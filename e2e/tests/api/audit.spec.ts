import { expect, test } from '@playwright/test';
import { createWorkspace, waitFor, type Workspace } from '../../src/api.ts';
import { apiUrl } from '../../src/env.ts';

// The audit log (issue #22) through the real API, no node needed: control plane mutations are recorded, filters and
// paging work, nothing secret is stored, and another organisation's log is out of reach. The gateway's own events
// (node connected, limit reached) need a live node and are checked in tests/serving/lifecycle.spec.ts.
test.describe.configure({ mode: 'serial' });

interface Entry {
  id: string;
  source: string;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  outcome: string;
  metadata: Record<string, unknown> | null;
}
interface Page {
  items: Entry[];
  nextCursor: string | null;
}

let ws: Workspace;
test.beforeAll(async () => {
  ws = await createWorkspace();
});
test.afterAll(async () => {
  await ws?.cleanup();
});

const logs = async (query = ''): Promise<Page> => {
  const res = await ws.cp.send('GET', `/organisations/${ws.org.id}/audit-logs${query}`);
  expect(res.status).toBe(200);
  return res.body as Page;
};
/** Rows are written just after the response, so poll for the one that should appear. */
const entry = (action: string, entityId?: string) =>
  waitFor(
    `the audit row ${action}`,
    async () =>
      (await logs(`?action=${action}&limit=100`)).items.find(
        (e) => !entityId || e.entityId === entityId,
      ),
    30_000,
    1_000,
  );

test('creating the organisation and the pool is recorded with who did it', async () => {
  const org = await entry('organisation.create', ws.org.id);
  expect(org).toMatchObject({ outcome: 'success', actorType: 'user', source: 'control-plane' });
  expect(org.actorId).toBeTruthy();
  const pool = await entry('pool.create', ws.pool.id);
  expect(pool.entityType).toBe('pool');
});

test('an API key is recorded without its secret', async () => {
  const key = await ws.apiKey();
  const row = await entry('api_key.create', key.id);
  expect(row.outcome).toBe('success');
  const all = JSON.stringify(await logs('?limit=100'));
  expect(all).not.toContain(key.secret);
  expect(all).not.toContain(key.secret.slice(0, 12));
});

test('an update records what changed, a delete records the entity', async () => {
  const patch = await ws.cp.send('PATCH', `/organisations/${ws.org.id}/pools/${ws.pool.id}`, {
    requireApproval: true,
  });
  expect(patch.status).toBe(200);
  const upd = await entry('pool.update', ws.pool.id);
  expect(JSON.stringify(upd.metadata)).toContain('requireApproval');

  const extra = await ws.cp.createPool(ws.org.id, 'e2e-audit-extra');
  await ws.cp.send('DELETE', `/organisations/${ws.org.id}/pools/${extra.id}`);
  expect((await entry('pool.delete', extra.id)).entityType).toBe('pool');
});

test('reads and rejected requests are not recorded as successes', async () => {
  const before = (await logs('?limit=100')).items.length;
  await ws.cp.send('GET', `/organisations/${ws.org.id}/pools`);
  await ws.cp.send('POST', `/organisations/${ws.org.id}/pools`, { name: ws.pool.name }); // 409
  await new Promise((r) => setTimeout(r, 2_000));
  const after = (await logs('?limit=100')).items;
  expect(after.length).toBe(before);
  expect(after.some((e) => e.action.startsWith('pool.') && e.outcome === 'denied')).toBe(false);
});

test('filters by category, exact action and outcome', async () => {
  const pools = (await logs('?action=pool.&limit=100')).items;
  expect(pools.length).toBeGreaterThan(0);
  expect(pools.every((e) => e.action.startsWith('pool.'))).toBe(true);
  const exact = (await logs('?action=pool.create&limit=100')).items;
  expect(exact.every((e) => e.action === 'pool.create')).toBe(true);
  expect((await logs('?outcome=denied')).items).toEqual([]);
  expect((await logs('?outcome=success&limit=100')).items.length).toBeGreaterThan(0);
});

test('pages newest first with a cursor and refuses a bad one', async () => {
  const first = await logs('?limit=2');
  expect(first.items).toHaveLength(2);
  expect(first.nextCursor).toBeTruthy();
  const second = await logs(`?limit=2&cursor=${first.nextCursor}`);
  const ids = new Set(first.items.map((e) => e.id));
  expect(second.items.length).toBeGreaterThan(0);
  expect(second.items.some((e) => ids.has(e.id))).toBe(false);
  const bad = await ws.cp.send('GET', `/organisations/${ws.org.id}/audit-logs?cursor=nonsense`);
  expect(bad.status).toBe(400);
});

test('another organisation’s log does not contain these entries, and an unknown one is not found', async () => {
  const other = await ws.cp.createOrg();
  try {
    const res = await ws.cp.send('GET', `/organisations/${other.id}/audit-logs?limit=100`);
    expect(res.status).toBe(200);
    const items = (res.body as Page).items;
    expect(items.some((e) => e.entityId === ws.pool.id)).toBe(false);
    const missing = await ws.cp.send(
      'GET',
      '/organisations/00000000-0000-4000-8000-000000000000/audit-logs',
    );
    expect(missing.status).toBe(404);
  } finally {
    await ws.cp.deleteOrg(other.id);
  }
});

test('the log needs a valid token', async () => {
  const res = await fetch(`${apiUrl}/organisations/${ws.org.id}/audit-logs`);
  expect(res.status).toBe(401);
});
