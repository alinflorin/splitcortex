import { describe, expect, it } from 'vitest';
import { bootstrapGarage } from './bootstrap';

const settings = {
  adminUrl: 'http://garage:3903',
  adminToken: 'tok',
  accessKeyId: 'GKabc',
  secretAccessKey: 'secret',
  bucket: 'models',
  zone: 'dc1',
  capacityBytes: 100,
};

/** A tiny fake of the Garage admin API that remembers what was configured. */
function fakeGarage() {
  const state = {
    roles: [] as { id: string }[],
    version: 0,
    keys: 0,
    bucketId: null as string | null,
    grants: 0,
  };
  const calls: string[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchFn = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace('/v2/', '');
    calls.push(path);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    switch (path) {
      case 'GetClusterStatus':
        return json({ nodes: [{ id: 'node1' }] });
      case 'GetClusterLayout':
        return json({ version: state.version, roles: state.roles });
      case 'UpdateClusterLayout':
        state.roles = (JSON.parse(init.body as string) as { roles: { id: string }[] }).roles;
        return json({});
      case 'ApplyClusterLayout':
        state.version = (JSON.parse(init.body as string) as { version: number }).version;
        return json({});
      case 'ImportKey':
        return state.keys++ === 0 ? json({}) : json({ message: 'exists' }, 409);
      case 'GetBucketInfo':
        return state.bucketId ? json({ id: state.bucketId }) : json({}, 404);
      case 'CreateBucket':
        state.bucketId = 'b1';
        return json({ id: 'b1' });
      case 'AllowBucketKey':
        state.grants++;
        return json({});
    }
    return json({}, 500);
  }) as unknown as typeof fetch;
  return { state, calls, fetchFn };
}

describe('bootstrapGarage', () => {
  it('sets up layout, key and bucket, and is idempotent', async () => {
    const g = fakeGarage();
    await bootstrapGarage(settings, g.fetchFn);
    expect(g.state).toMatchObject({ version: 1, bucketId: 'b1', grants: 1 });
    expect(g.state.roles).toEqual([{ id: 'node1', zone: 'dc1', capacity: 100, tags: [] }]);

    const before = g.calls.length;
    await bootstrapGarage(settings, g.fetchFn); // second start: nothing is recreated
    const second = g.calls.slice(before);
    expect(second).not.toContain('UpdateClusterLayout');
    expect(second).not.toContain('CreateBucket');
    expect(g.state.version).toBe(1);
  });

  it('fails (so the caller retries) while Garage is not ready', async () => {
    const down = (async () => new Response('starting', { status: 503 })) as unknown as typeof fetch;
    await expect(bootstrapGarage(settings, down)).rejects.toThrow('503');
  });
});
