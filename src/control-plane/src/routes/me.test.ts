import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  return res.json<{ id: string }>().id;
}

describe('DELETE /me', () => {
  it('is refused while the caller is the only owner of an organisation', async () => {
    await newOrg('solo@x.io', 'solo-org');
    const res = await call('DELETE', '/me', 'solo@x.io');
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toContain('solo-org');
    expect((await call('GET', '/organisations', 'solo@x.io')).json()).toHaveLength(1);
  });

  it('removes memberships and anonymises what the user created', async () => {
    const id = await newOrg('keep@x.io', 'kept-org');
    await call('POST', `/organisations/${id}/members`, 'keep@x.io', {
      email: 'gone@x.io',
      role: 'admin',
    });
    const key = await call('POST', `/organisations/${id}/api-keys`, 'gone@x.io', {
      name: 'k',
      scope: 'org',
    });
    expect(key.statusCode).toBe(201);

    expect((await call('DELETE', '/me', 'gone@x.io')).statusCode).toBe(204);

    expect((await call('GET', '/organisations', 'gone@x.io')).json()).toEqual([]);
    expect((await call('GET', `/organisations/${id}`, 'gone@x.io')).statusCode).toBe(404);
    const keys = await call('GET', `/organisations/${id}/api-keys`, 'keep@x.io');
    expect(keys.json()[0].createdBy).toBe('deleted');
    const members = await call('GET', `/organisations/${id}/members`, 'keep@x.io');
    expect(members.json().map((m: { email: string }) => m.email)).toEqual(['keep@x.io']);
  });

  it('works for a user without any membership', async () => {
    expect((await call('DELETE', '/me', 'nobody@x.io')).statusCode).toBe(204);
  });
});
