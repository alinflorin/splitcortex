import { expect, test } from '@playwright/test';
import { createWorkspace, type Workspace } from '../../src/api.ts';
import { apiUrl } from '../../src/env.ts';

// Account deletion (issue #24). The e2e login is shared by every suite (and by parallel CI jobs), so the successful
// deletion is deliberately NOT exercised here: it would remove the login's memberships from the other suites' orgs.
// That path is covered by the control plane's own tests (src/control-plane/src/routes/me.test.ts). What is safe, and
// matters most, is the guard: a sole owner cannot delete the account and nothing is touched when it is refused.
test.describe.configure({ mode: 'serial' });

let ws: Workspace;
test.beforeAll(async () => {
  ws = await createWorkspace();
});
test.afterAll(async () => {
  await ws?.cleanup();
});

test('GET /me returns the signed-in user', async () => {
  const me = await ws.cp.send('GET', '/me');
  expect(me.status).toBe(200);
  expect((me.body as { email: string }).email).toContain('@');
});

test('deleting the account needs a token', async () => {
  const res = await fetch(`${apiUrl}/me`, { method: 'DELETE' });
  expect(res.status).toBe(401);
});

test('a sole owner cannot delete the account, and nothing changes', async () => {
  const res = await ws.cp.send('DELETE', '/me');
  expect(res.status).toBe(409);
  expect((res.body as { message: string }).message).toContain(ws.org.name);
  // The organisation, the membership and the pool are all still there.
  expect((await ws.cp.listOrgs()).map((o) => o.id)).toContain(ws.org.id);
  expect(await ws.cp.probe(`/organisations/${ws.org.id}/pools/${ws.pool.id}`)).toBe(200);
});

test('the refusal is in the requested language', async () => {
  const res = await fetch(`${apiUrl}/me`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${await token()}`, 'accept-language': 'ro' },
  });
  expect(res.status).toBe(409);
  expect(res.headers.get('content-language')).toBe('ro');
});

async function token(): Promise<string> {
  const { getAccessToken } = await import('../../src/dex.ts');
  return getAccessToken();
}
