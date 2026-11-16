import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshEnrollmentInfo } from './info';

const h = vi.hoisted(() => ({
  stored: {
    nodeId: 'n1',
    fingerprint: 'F',
    approved: false,
    enrollmentUrl: 'https://app.test/api',
    gateway: null,
    enrolledAt: '2026-01-01T00:00:00.000Z',
    orgName: 'Old name',
  },
  saved: null as unknown,
}));
vi.mock('./store', () => ({
  loadEnrollment: async () => h.stored,
  saveEnrollment: async (e: unknown) => {
    h.saved = e;
  },
}));
vi.mock('./identity', () => ({
  getOrCreateIdentity: async () => ({ privateKey: new Uint8Array(32).fill(7) }),
}));

describe('refreshEnrollmentInfo', () => {
  beforeEach(() => (h.saved = null));

  it('signs a request for the device route and stores the organisation, pool, name and approval', async () => {
    const doFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ name: 'Pixel', orgName: 'Acme', poolName: 'Edge', approved: true }),
        ),
    );
    const out = await refreshEnrollmentInfo(doFetch as unknown as typeof fetch);
    const [url, init] = doFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://app.test/api/node/me');
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Node n1\.\d+\./);
    expect(out).toMatchObject({
      orgName: 'Acme',
      poolName: 'Edge',
      deviceName: 'Pixel',
      approved: true,
    });
    expect(h.saved).toEqual(out);
  });

  it('keeps what is stored when the control plane refuses or is unreachable', async () => {
    const refused = vi.fn(async () => new Response('no', { status: 401 }));
    expect(await refreshEnrollmentInfo(refused as unknown as typeof fetch)).toEqual(h.stored);
    const offline = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await refreshEnrollmentInfo(offline as unknown as typeof fetch)).toEqual(h.stored);
    expect(h.saved).toBeNull();
  });
});
