import { randomBytes } from 'node:crypto';
import { apiUrl } from './env.ts';
import { getAccessToken } from './dex.ts';

// A thin client for the control plane calls the suites need (DTOs are not shared; only the fields used are typed).
export interface Org {
  id: string;
  name: string;
  slug: string;
}
export interface Pool {
  id: string;
  name: string;
}
export interface NodeInfo {
  id: string;
  name: string;
  platform: string | null;
  approved: boolean;
  status: 'pending' | 'online' | 'offline';
}

export class ControlPlane {
  private constructor(private readonly token: string) {}

  static async signIn(): Promise<ControlPlane> {
    return new ControlPlane(await getAccessToken());
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  createOrg(): Promise<Org> {
    const slug = `e2e-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
    return this.call('POST', '/organisations', { name: `E2E ${slug}`, slug });
  }
  deleteOrg(orgId: string): Promise<void> {
    return this.call('DELETE', `/organisations/${orgId}`);
  }
  createPool(orgId: string, name = 'e2e-pool'): Promise<Pool> {
    return this.call('POST', `/organisations/${orgId}/pools`, { name });
  }
  /** `XXXX-XXXXXX`, valid ~10 minutes, single use. */
  async createEnrollmentCode(orgId: string, poolId: string): Promise<string> {
    const r = await this.call<{ code: string }>(
      'POST',
      `/organisations/${orgId}/pools/${poolId}/enrollments`,
    );
    return r.code;
  }
  listNodes(orgId: string, poolId: string): Promise<NodeInfo[]> {
    return this.call('GET', `/organisations/${orgId}/pools/${poolId}/nodes`);
  }
}

/** A throwaway org + pool; `cleanup` deletes the org with everything in it. */
export async function createWorkspace() {
  const cp = await ControlPlane.signIn();
  const org = await cp.createOrg();
  const pool = await cp.createPool(org.id);
  return {
    cp,
    org,
    pool,
    code: () => cp.createEnrollmentCode(org.id, pool.id),
    nodes: () => cp.listNodes(org.id, pool.id),
    cleanup: () => cp.deleteOrg(org.id),
  };
}
export type Workspace = Awaited<ReturnType<typeof createWorkspace>>;

/** Polls until `check` returns a value (not undefined) or the time is up. */
export async function waitFor<T>(
  what: string,
  check: () => Promise<T | undefined>,
  timeoutMs = 60_000,
  everyMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
