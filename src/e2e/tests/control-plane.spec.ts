import { expect, test, type Page } from '@playwright/test';
import { api, cp, createOrg, deleteOrg, uniq, userPage, type Reply } from '../lib/api';
import { baseUrl, users } from '../lib/env';

// The control plane's API through a throw-away organisation (created and deleted by this file, so the run's own
// organisation and its models stay untouched): sign-in, organisation settings, pools, enrollment codes, members and
// what each role may do, usage and metrics, the audit log (filter, pages, export) and deleting the organisation.
test.describe.configure({ mode: 'serial' });

interface Pool {
  id: string;
  name: string;
  requireApproval: boolean;
  balancingType: string;
  servingType: string;
  onlineNodes: number;
  totalNodes: number;
}
interface Member {
  email: string;
  role: string;
}
interface Err {
  statusCode: number;
  message: string;
}
interface AuditPage {
  items: {
    id: string;
    action: string;
    actorType: string;
    actorId: string | null;
    source: string;
  }[];
  nextCursor: string | null;
}

let owner: Page;
let second: Page | null = null;
let org: { id: string; slug: string };
let poolId: string;
const me = () => users()[0]!.email.toLowerCase();
const other = () => users()[1]?.email.toLowerCase();
const o = () => `/organisations/${org.id}`;
const member = (email: string) => `${o()}/members/${encodeURIComponent(email)}`;

test.beforeAll(async ({ browser }) => {
  owner = await userPage(browser, 0);
  org = await createOrg(owner, 'cp');
  if (users().length > 1) second = await userPage(browser, 1);
});

test.afterAll(async () => {
  await deleteOrg(owner, org.id);
  await owner.context().close();
  await second?.context().close();
});

test('the API needs a valid token', async () => {
  for (const headers of [
    {} as Record<string, string>,
    { authorization: 'Bearer nope' },
    { authorization: 'Basic abc' },
  ]) {
    const res = await owner.request.fetch(`${baseUrl()}/api/organisations`, { headers });
    expect(res.status(), JSON.stringify(headers)).toBe(401);
  }
  // Public: liveness and the API description.
  expect((await owner.request.fetch(`${baseUrl()}/api/docs`)).status()).toBeLessThan(400);
});

test('/me is the signed-in user', async () => {
  const res = await api<{ email: string; subject: string }>(owner, 'GET', '/me');
  expect(res.status).toBe(200);
  expect(res.body.email.toLowerCase()).toBe(me());
  expect(res.body.subject).toBeTruthy();
});

test('organisation: read, rename, slug rules', async () => {
  const read = await api<{ id: string; role: string; slug: string }>(owner, 'GET', o());
  expect(read.body.role).toBe('owner');
  expect(read.body.slug).toBe(org.slug);

  const renamed = await api<{ name: string }>(owner, 'PATCH', o(), { name: 'e2e renamed' });
  expect(renamed.status).toBe(200);
  expect(renamed.body.name).toBe('e2e renamed');
  expect((await api(owner, 'PATCH', o(), {})).status, 'nothing to change').toBe(400);
  expect((await api(owner, 'PATCH', o(), { name: '' })).status).toBe(400);

  for (const slug of ['Bad Slug', 'a', '-x', 'x-', 'two--dashes', 'UPPER_case']) {
    const res = await api(owner, 'POST', '/organisations', { name: 'x', slug });
    expect(res.status, slug).toBe(400);
  }
  // A second organisation cannot take the first one's slug.
  const clash = await api<Err>(owner, 'POST', '/organisations', { name: 'again', slug: org.slug });
  expect(clash.status).toBe(409);
  expect(clash.body.message).toBe('Slug already taken');

  const list = await api<{ id: string }[]>(owner, 'GET', '/organisations');
  expect(list.body.map((x) => x.id)).toContain(org.id);
  expect((await api(owner, 'GET', `/organisations/${crypto.randomUUID()}`)).status).toBe(404);
  expect((await api(owner, 'GET', '/organisations/not-a-uuid')).status).toBe(400);
});

test('pools: create, duplicate name, update, read, delete', async () => {
  const name = `pool-${uniq()}`;
  const created = await api<Pool>(owner, 'POST', `${o()}/pools`, { name });
  expect(created.status).toBe(201);
  poolId = created.body.id;
  expect(created.body).toMatchObject({
    name,
    requireApproval: false,
    servingType: 'replicated',
    balancingType: 'weighted_p2c',
    onlineNodes: 0,
    totalNodes: 0,
  });

  const dup = await api<Err>(owner, 'POST', `${o()}/pools`, { name });
  expect(dup.status).toBe(409);
  expect(dup.body.message).toBe('A pool with this name already exists');
  expect((await api(owner, 'POST', `${o()}/pools`, { name: '' })).status).toBe(400);
  expect(
    (await api(owner, 'POST', `${o()}/pools`, { name: 'x', balancingType: 'magic' })).status,
  ).toBe(400);

  // An update changes only what it names.
  const patched = await api<Pool>(owner, 'PATCH', `${o()}/pools/${poolId}`, {
    balancingType: 'round_robin',
    requireApproval: true,
  });
  expect(patched.status).toBe(200);
  expect(patched.body).toMatchObject({ name, balancingType: 'round_robin', requireApproval: true });
  const renamed = await api<Pool>(owner, 'PATCH', `${o()}/pools/${poolId}`, { name: `${name}-b` });
  expect(renamed.body).toMatchObject({
    name: `${name}-b`,
    balancingType: 'round_robin',
    requireApproval: true,
  });
  expect((await api(owner, 'PATCH', `${o()}/pools/${poolId}`, {})).status).toBe(400);

  const read = await api<Pool>(owner, 'GET', `${o()}/pools/${poolId}`);
  expect(read.body.id).toBe(poolId);
  const list = await api<Pool[]>(owner, 'GET', `${o()}/pools`);
  expect(list.body.map((p) => p.id)).toContain(poolId);

  const nodes = await api<unknown[]>(owner, 'GET', `${o()}/pools/${poolId}/nodes`);
  expect(nodes.body).toEqual([]);
  expect((await api(owner, 'GET', `${o()}/nodes/${crypto.randomUUID()}`)).status).toBe(404);
  expect((await api(owner, 'POST', `${o()}/nodes/${crypto.randomUUID()}/restart`)).status).toBe(
    404,
  );
  expect((await api(owner, 'GET', `${o()}/pools/${crypto.randomUUID()}`)).status).toBe(404);

  // Benchmarks need a model and a device.
  const noModel = await api(owner, 'POST', `${o()}/pools/${poolId}/benchmarks`, {});
  expect(noModel.status).toBeGreaterThanOrEqual(400);
  expect(noModel.status).toBeLessThan(500);

  // A pool with no model serves nothing; the model list is empty.
  const served = await api<unknown[]>(owner, 'GET', `${o()}/pools/${poolId}/models`);
  expect(served.body).toEqual([]);
});

test('enrollment codes: one, many, cancel; a stranger gets a generic 404', async () => {
  const one = await api<{
    code: string;
    enrollment: { id: string; maxAttempts: number; expiresAt: string };
  }>(owner, 'POST', `${o()}/pools/${poolId}/enrollments`);
  expect(one.status).toBe(201);
  expect(one.body.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{6}$/);
  expect(one.body.enrollment.maxAttempts).toBe(3);
  const minutes = (Date.parse(one.body.enrollment.expiresAt) - Date.now()) / 60_000;
  expect(minutes).toBeGreaterThan(8);
  expect(minutes).toBeLessThanOrEqual(10.5);

  const bulk = await api<{ items: { code: string }[] }>(
    owner,
    'POST',
    `${o()}/pools/${poolId}/enrollments/bulk`,
    {
      count: 3,
    },
  );
  expect(bulk.status).toBe(201);
  const codes = bulk.body.items.map((i) => i.code);
  expect(new Set([...codes, one.body.code]).size, 'every code is different').toBe(4);
  for (const count of [0, 51, 1.5]) {
    expect(
      (await api(owner, 'POST', `${o()}/pools/${poolId}/enrollments/bulk`, { count })).status,
      `${count}`,
    ).toBe(400);
  }

  // The list never contains a code.
  const active = await api<{ id: string }[]>(owner, 'GET', `${o()}/pools/${poolId}/enrollments`);
  expect(active.body.length).toBe(4);
  expect(JSON.stringify(active.body)).not.toContain(one.body.code);

  const cancel = `${o()}/enrollments/${one.body.enrollment.id}`;
  expect((await api(owner, 'DELETE', cancel)).status).toBe(204);
  expect((await api(owner, 'DELETE', cancel)).status).toBe(404);
  expect((await api(owner, 'GET', `${o()}/pools/${poolId}/enrollments`)).body).toHaveLength(3);

  // Device side (no sign-in): an unknown code is a generic 404, whatever is sent.
  const b64 = (n: number) => Buffer.alloc(n, 7).toString('base64url');
  const start = await owner.request.fetch(`${baseUrl()}/api/enroll/start`, {
    method: 'POST',
    data: { lookupId: 'ZZZZ', sid: b64(16), share: b64(32) },
  });
  expect(start.status()).toBe(404);
  expect(((await start.json()) as Err).message).toBe('Invalid or expired code');
  const complete = await owner.request.fetch(`${baseUrl()}/api/enroll/complete`, {
    method: 'POST',
    data: { lookupId: 'ZZZZ', sealed: b64(64) },
  });
  expect(complete.status()).toBe(404);
  const malformed = await owner.request.fetch(`${baseUrl()}/api/enroll/start`, {
    method: 'POST',
    data: { lookupId: 'x', sid: '!', share: '' },
  });
  expect(malformed.status()).toBe(400);

  // Revoked node credentials do not open the device API.
  const node = await owner.request.fetch(`${baseUrl()}/api/node/models`, {
    headers: { authorization: 'Bearer nope' },
  });
  expect(node.status()).toBeGreaterThanOrEqual(400);
  expect(node.status()).toBeLessThan(500);
});

test('usage and metrics: shapes, ranges, filters', async () => {
  const usage = await api<{
    granularity: string;
    totals: { requests: number; tokensIn: number; tokensOut: number; errors: number };
    series: unknown[];
  }>(owner, 'GET', `${o()}/usage`);
  expect(usage.status).toBe(200);
  expect(usage.body.granularity).toBe('day');
  expect(usage.body.totals).toEqual({ requests: 0, tokensIn: 0, tokensOut: 0, errors: 0 });
  expect(Array.isArray(usage.body.series)).toBe(true);
  for (const q of [
    'groupBy=pool',
    'groupBy=key',
    'groupBy=model',
    'granularity=hour',
    `poolId=${poolId}`,
  ]) {
    expect((await api(owner, 'GET', `${o()}/usage?${q}`)).status, q).toBe(200);
  }
  const now = new Date();
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  expect(
    (await api(owner, 'GET', `${o()}/usage?from=${now.toISOString()}&to=${ago(1)}`)).status,
  ).toBe(400);
  expect(
    (await api(owner, 'GET', `${o()}/usage?from=${ago(200)}&to=${now.toISOString()}`)).status,
  ).toBe(400);
  expect((await api(owner, 'GET', `${o()}/usage?groupBy=nope`)).status).toBe(400);

  const metrics = await api<{ step: string; pools: unknown[]; nodes: unknown[] }>(
    owner,
    'GET',
    `${o()}/metrics`,
  );
  expect(metrics.status).toBe(200);
  expect(Array.isArray(metrics.body.pools)).toBe(true);
  expect(Array.isArray(metrics.body.nodes)).toBe(true);
  expect((await api(owner, 'GET', `${o()}/metrics?step=1m&poolId=${poolId}`)).status).toBe(200);
  expect((await api(owner, 'GET', `${o()}/metrics?step=2m`)).status).toBe(400);
  expect(
    (await api(owner, 'GET', `${o()}/metrics?from=${ago(30)}&to=${now.toISOString()}`)).status,
  ).toBe(400);
  expect(
    (await api(owner, 'GET', `${o()}/metrics?from=${now.toISOString()}&to=${ago(1)}`)).status,
  ).toBe(400);
});

test('members and roles', async () => {
  test.skip(!second, 'needs a second E2E user');
  const two = other()!;
  const s = second!;

  // The creator is the owner; a second person is added by email.
  const list = await api<Member[]>(owner, 'GET', `${o()}/members`);
  expect(list.body).toEqual([expect.objectContaining({ email: me(), role: 'owner' })]);
  expect((await api(s, 'GET', o())).status, 'not a member yet: the organisation is hidden').toBe(
    404,
  );

  const added = await api<Member>(owner, 'POST', `${o()}/members`, { email: two, role: 'member' });
  expect(added.status).toBe(201);
  expect(added.body).toMatchObject({ email: two, role: 'member' });
  expect(
    (await api(owner, 'POST', `${o()}/members`, { email: two.toUpperCase() })).status,
    'email is case-insensitive',
  ).toBe(409);
  expect((await api(owner, 'POST', `${o()}/members`, { email: 'not an email' })).status).toBe(400);
  expect(
    (await api(owner, 'POST', `${o()}/members`, { email: 'x@example.com', role: 'god' })).status,
  ).toBe(400);

  // A plain member reads, but cannot change anything.
  const asMember = await api<{ role: string }>(s, 'GET', o());
  expect(asMember.body.role).toBe('member');
  for (const path of ['pools', 'members', 'usage', 'metrics', 'models']) {
    expect((await api(s, 'GET', `${o()}/${path}`)).status, `member reads ${path}`).toBe(200);
  }
  const denied: [Reply, string][] = [
    [await api(s, 'POST', `${o()}/pools`, { name: 'nope' }), 'create pool'],
    [await api(s, 'PATCH', `${o()}/pools/${poolId}`, { name: 'nope' }), 'rename pool'],
    [await api(s, 'DELETE', `${o()}/pools/${poolId}`), 'delete pool'],
    [await api(s, 'GET', `${o()}/api-keys`), 'list keys'],
    [await api(s, 'POST', `${o()}/api-keys`, { name: 'k', scope: 'org' }), 'create key'],
    [await api(s, 'POST', `${o()}/pools/${poolId}/enrollments`), 'enrollment code'],
    [await api(s, 'GET', `${o()}/audit-logs`), 'audit log'],
    [await api(s, 'GET', `${o()}/audit-logs/export`), 'audit export'],
    [await api(s, 'POST', `${o()}/members`, { email: 'x@example.com' }), 'add member'],
    [await api(s, 'PATCH', o(), { name: 'nope' }), 'rename organisation'],
    [await api(s, 'DELETE', o()), 'delete organisation'],
  ];
  for (const [res, what] of denied) expect(res.status, what).toBe(403);
  expect((await api<Err>(s, 'GET', `${o()}/audit-logs`)).body.message).toBe('Insufficient role');

  // An admin manages pools, keys and plain members, but not other admins or owners.
  const promoted = await api<Member>(owner, 'PATCH', member(two), { role: 'admin' });
  expect(promoted.body.role).toBe('admin');
  const adminPool = await api<Pool>(s, 'POST', `${o()}/pools`, { name: `admin-${uniq()}` });
  expect(adminPool.status).toBe(201);
  expect((await api(s, 'DELETE', `${o()}/pools/${adminPool.body.id}`)).status).toBe(204);
  expect((await api(s, 'GET', `${o()}/audit-logs`)).status).toBe(200);
  const guest = `guest-${uniq()}@example.com`;
  expect((await api(s, 'POST', `${o()}/members`, { email: guest, role: 'member' })).status).toBe(
    201,
  );
  expect(
    (await api(s, 'POST', `${o()}/members`, { email: `x-${guest}`, role: 'admin' })).status,
    'cannot make admins',
  ).toBe(403);
  expect(
    (await api(s, 'PATCH', member(me()), { role: 'member' })).status,
    'cannot demote the owner',
  ).toBe(403);
  expect((await api(s, 'DELETE', member(me()))).status, 'cannot remove the owner').toBe(403);
  expect((await api(s, 'DELETE', o())).status, 'only an owner deletes').toBe(403);
  expect((await api(s, 'PATCH', o(), { name: 'by admin' })).status).toBe(200);
  expect((await api(owner, 'PATCH', o(), { name: 'e2e renamed' })).status).toBe(200);

  // The last owner can neither be demoted nor leave.
  const demote = await api<Err>(owner, 'PATCH', member(me()), { role: 'admin' });
  expect(demote.status).toBe(409);
  expect(demote.body.message).toBe('An organisation needs at least one owner');
  expect((await api(owner, 'DELETE', member(me()))).status).toBe(409);
  expect((await api(owner, 'PATCH', member('nobody@example.com'), { role: 'member' })).status).toBe(
    404,
  );

  // Removing: the owner removes the guest; the admin leaves by themselves.
  expect((await api(owner, 'DELETE', member(guest))).status).toBe(204);
  expect((await api(owner, 'DELETE', member(guest))).status).toBe(404);
  expect((await api(s, 'DELETE', member(two))).status, 'leave').toBe(204);
  expect((await api(s, 'GET', o())).status, 'no access after leaving').toBe(404);
  expect((await api(s, 'GET', `${o()}/pools`)).status).toBe(404);
  expect((await api(owner, 'GET', `${o()}/members`)).body).toHaveLength(1);
});

test('audit log: what happened, filters, pages, export', async () => {
  const audit = (q = '') => api<AuditPage>(owner, 'GET', `${o()}/audit-logs?${q}`);

  const all = await audit('limit=100');
  expect(all.status).toBe(200);
  const actions = all.body.items.map((i) => i.action);
  expect(actions).toEqual(expect.arrayContaining(['pool.create', 'pool.update']));
  expect(all.body.items.every((i) => i.source === 'control_plane')).toBe(true);

  const pools = await audit('action=pool.&limit=100');
  expect(pools.body.items.length).toBeGreaterThan(0);
  expect(pools.body.items.every((i) => i.action.startsWith('pool.'))).toBe(true);
  const exact = await audit('action=pool.create&limit=100');
  expect(exact.body.items.every((i) => i.action === 'pool.create')).toBe(true);
  const mine = await audit(`actor=${encodeURIComponent(me())}&limit=100`);
  expect(mine.body.items.length).toBeGreaterThan(0);
  expect(mine.body.items.every((i) => i.actorType === 'user' && i.actorId === me())).toBe(true);
  expect((await audit('source=gateway')).body.items).toEqual([]);
  expect((await audit('outcome=denied&limit=100')).status).toBe(200);
  expect((await audit('outcome=maybe')).status).toBe(400);
  expect((await audit('limit=0')).status).toBe(400);
  expect((await audit('limit=101')).status).toBe(400);
  expect((await audit('cursor=garbage')).status).toBe(400);

  // Newest first, and pages do not overlap.
  const first = await audit('limit=2');
  expect(first.body.items).toHaveLength(2);
  expect(first.body.nextCursor).toBeTruthy();
  const next = await audit(`limit=2&cursor=${first.body.nextCursor}`);
  const seen = new Set(first.body.items.map((i) => i.id));
  for (const i of next.body.items) expect(seen.has(i.id), 'no row twice').toBe(false);

  const csv = await cp(owner, 'GET', `${o()}/audit-logs/export?format=csv`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(csv.headers()['content-disposition']).toContain('attachment');
  const text = await csv.text();
  expect(text.split('\r\n').length).toBeGreaterThan(2);
  expect(text).toContain('pool.create');

  const json = await cp(owner, 'GET', `${o()}/audit-logs/export?format=json&action=pool.`);
  const rows = (await json.json()) as { action: string }[];
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.action.startsWith('pool.'))).toBe(true);
});

test('deleting the organisation', async () => {
  expect((await api(owner, 'DELETE', `${o()}/pools/${poolId}`)).status).toBe(204);
  expect((await api(owner, 'GET', `${o()}/pools/${poolId}`)).status).toBe(404);
  expect((await api(owner, 'DELETE', `${o()}/pools/${poolId}`)).status).toBe(404);

  // Another (empty) organisation: the owner deletes it, and it is gone for good.
  const tmp = await createOrg(owner, 'del');
  expect((await api(owner, 'DELETE', `/organisations/${tmp.id}`)).status).toBe(204);
  expect((await api(owner, 'GET', `/organisations/${tmp.id}`)).status).toBe(404);
  expect((await api(owner, 'DELETE', `/organisations/${tmp.id}`)).status).toBe(404);
  const list = await api<{ id: string }[]>(owner, 'GET', '/organisations');
  expect(list.body.map((x) => x.id)).not.toContain(tmp.id);
});
