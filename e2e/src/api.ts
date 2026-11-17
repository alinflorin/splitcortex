import { randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';
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

export interface ModelInfo {
  id: string;
  name: string;
  status: 'pending' | 'downloading' | 'uploading' | 'ready' | 'failed';
  error: string | null;
}

export interface Limits {
  requestsPerMinute: number | null;
  tokensPerMinute: number | null;
  tokensPerDay: number | null;
}
export interface Usage {
  totals: { tokensIn: number; tokensOut: number; requests: number; errors: number };
  series: { group: string | null; tokensIn: number; tokensOut: number; requests: number }[];
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
  /** Uploads a model file through the control plane (multipart, part by part) and returns it once stored. */
  async uploadModel(
    orgId: string,
    name: string,
    file: { path: string; fileName: string; sizeBytes: number },
  ): Promise<ModelInfo> {
    const { model, partSize, partCount } = await this.call<{
      model: ModelInfo;
      partSize: number;
      partCount: number;
    }>('POST', `/organisations/${orgId}/models/uploads`, {
      name,
      fileName: file.fileName,
      sizeBytes: file.sizeBytes,
    });
    const parts: { partNumber: number; etag: string }[] = [];
    const handle = await open(file.path, 'r');
    try {
      for (let n = 1; n <= partCount; n++) {
        const length = Math.min(partSize, file.sizeBytes - partSize * (n - 1));
        const buf = Buffer.alloc(length);
        await handle.read(buf, 0, length, partSize * (n - 1));
        const res = await fetch(`${apiUrl}/organisations/${orgId}/models/${model.id}/parts/${n}`, {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${this.token}`,
            'content-type': 'application/octet-stream',
          },
          body: buf,
        });
        if (!res.ok) throw new Error(`PUT model part ${n} -> ${res.status}`);
        parts.push({ partNumber: n, etag: ((await res.json()) as { etag: string }).etag });
      }
    } finally {
      await handle.close();
    }
    return this.call('POST', `/organisations/${orgId}/models/${model.id}/complete`, { parts });
  }
  /** Serve the model from the pool (replaces the pool's current one). */
  assignModel(orgId: string, poolId: string, modelId: string): Promise<void> {
    return this.call('PUT', `/organisations/${orgId}/pools/${poolId}/models/${modelId}`);
  }
  /** The secret is only returned here. `poolIds` scopes the key to those pools (default: the whole org). */
  async createApiKey(
    orgId: string,
    opts: { poolIds?: string[]; limits?: Partial<Limits> } = {},
  ): Promise<{ id: string; secret: string }> {
    const scope = opts.poolIds ? { scope: 'pools', poolIds: opts.poolIds } : { scope: 'org' };
    const r = await this.call<{ key: { id: string }; secret: string }>(
      'POST',
      `/organisations/${orgId}/api-keys`,
      { name: 'e2e', ...scope, ...(opts.limits && { limits: opts.limits }) },
    );
    return { id: r.key.id, secret: r.secret };
  }
  revokeApiKey(orgId: string, keyId: string): Promise<void> {
    return this.call('DELETE', `/organisations/${orgId}/api-keys/${keyId}`);
  }
  /** Usage of the org, grouped by key (the default window is the last 7 days). */
  usageByKey(orgId: string): Promise<Usage> {
    return this.call('GET', `/organisations/${orgId}/usage?groupBy=key&granularity=day`);
  }
  /** The HTTP status of a GET as this user, without throwing (for "must not be reachable" checks). */
  async probe(path: string): Promise<number> {
    const res = await fetch(`${apiUrl}${path}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    return res.status;
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
    /** Uploads `file` as a model of the org and makes the pool serve it. */
    serveModel: async (name: string, file: Parameters<ControlPlane['uploadModel']>[2]) => {
      const model = await cp.uploadModel(org.id, name, file);
      await cp.assignModel(org.id, pool.id, model.id);
      return model;
    },
    apiKey: (opts?: Parameters<ControlPlane['createApiKey']>[1]) => cp.createApiKey(org.id, opts),
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
