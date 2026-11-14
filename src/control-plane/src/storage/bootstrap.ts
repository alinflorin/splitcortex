/**
 * First-boot setup of a single-node Garage through its admin API (v2): assign the node a layout, import the S3 key the
 * control plane uses and create the bucket with that key allowed on it. Every step checks first, so it is safe to run on
 * each start (and while Garage is still coming up: the caller retries).
 */
export interface GarageBootstrapSettings {
  adminUrl: string;
  adminToken: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Layout zone and declared capacity of the single node. */
  zone: string;
  capacityBytes: number;
}

type Fetch = typeof fetch;

export async function bootstrapGarage(s: GarageBootstrapSettings, fetchFn: Fetch = fetch) {
  const call = async (
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    okStatuses: number[] = [],
  ) => {
    const res = await fetchFn(`${s.adminUrl.replace(/\/$/, '')}/v2/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${s.adminToken}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok && !okStatuses.includes(res.status))
      throw new Error(`Garage admin ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res;
  };

  // 1. Layout: a single node needs one role before it stores anything.
  const status = (await (await call('GET', 'GetClusterStatus')).json()) as {
    nodes: { id: string }[];
  };
  const nodeId = status.nodes[0]?.id;
  if (!nodeId) throw new Error('Garage reports no nodes yet');
  const layout = (await (await call('GET', 'GetClusterLayout')).json()) as {
    version: number;
    roles: { id: string }[];
  };
  if (!layout.roles.some((r) => r.id === nodeId)) {
    await call('POST', 'UpdateClusterLayout', {
      roles: [{ id: nodeId, zone: s.zone, capacity: s.capacityBytes, tags: [] }],
    });
    await call('POST', 'ApplyClusterLayout', { version: layout.version + 1 });
  }

  // 2. The S3 key (an existing identical key answers 409 / already exists).
  await call(
    'POST',
    'ImportKey',
    { accessKeyId: s.accessKeyId, secretAccessKey: s.secretAccessKey, name: 'control-plane' },
    [409],
  );

  // 3. The bucket and the key's access to it.
  let res = await call(
    'GET',
    `GetBucketInfo?globalAlias=${encodeURIComponent(s.bucket)}`,
    undefined,
    [404],
  );
  if (res.status === 404) res = await call('POST', 'CreateBucket', { globalAlias: s.bucket });
  const bucket = (await res.json()) as { id: string };
  await call('POST', 'AllowBucketKey', {
    bucketId: bucket.id,
    accessKeyId: s.accessKeyId,
    permissions: { read: true, write: true, owner: true },
  });
}

/** Runs the bootstrap in the background, retrying with backoff until it works (Garage may still be starting). */
export function startGarageBootstrap(
  s: GarageBootstrapSettings,
  log: { info(msg: string): void; warn(obj: object, msg: string): void },
  fetchFn: Fetch = fetch,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let delay = 2_000;
  const attempt = async () => {
    try {
      await bootstrapGarage(s, fetchFn);
      log.info('Garage is bootstrapped (layout, key, bucket)');
    } catch (err) {
      if (stopped) return;
      log.warn({ err: String(err) }, 'Garage bootstrap not done yet, retrying');
      timer = setTimeout(() => void attempt(), delay);
      delay = Math.min(delay * 2, 60_000);
    }
  };
  void attempt();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
