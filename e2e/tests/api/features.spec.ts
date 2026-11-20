import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createWorkspace, waitFor, type ModelInfo, type Workspace } from '../../src/api.ts';
import { apiUrl } from '../../src/env.ts';
import { enrollDevice } from '../../src/perf/fake-node.ts';
import { placeholderModel } from '../../src/placeholder.ts';

// Rules of the control plane that need no live node: remote restart, model kinds, benchmarks of an embedding pool,
// the audit export, bulk enrollment codes and API key expiry changes. (The org's only login is its owner, so the
// plain-member refusals, 403, are covered by the control plane's own tests, not here.)
test.describe.configure({ mode: 'serial' });

let ws: Workspace;
const org = () => ws.org.id;
test.beforeAll(async () => {
  ws = await createWorkspace();
});
test.afterAll(async () => {
  await ws?.cleanup();
});

const HF = 'https://huggingface.co/e2e-nonexistent/e2e-model/resolve/main/e2e.litertlm';
const unknown = () => randomUUID();

test.describe('remote restart', () => {
  test('a device that is not connected cannot be restarted (409)', async () => {
    // Enrolled, but never connected to the gateway: the node exists and is offline.
    const enrolled = await enrollDevice(apiUrl, await ws.code(), 'e2e-restart-offline');
    const res = await ws.cp.restartNode(org(), enrolled.nodeId);
    expect(res.status).toBe(409);
  });

  test('an unknown device, an unknown organisation and another tenant are 404', async () => {
    expect((await ws.cp.restartNode(org(), unknown())).status).toBe(404);
    // An organisation this login is not a member of looks the same as one that does not exist.
    expect((await ws.cp.restartNode(unknown(), unknown())).status).toBe(404);
    // A device of this organisation asked for through another organisation of the same login: not found there.
    const enrolled = await enrollDevice(apiUrl, await ws.code(), 'e2e-restart-tenant');
    const other = await ws.cp.createOrg();
    try {
      expect((await ws.cp.restartNode(other.id, enrolled.nodeId)).status).toBe(404);
    } finally {
      await ws.cp.deleteOrg(other.id);
    }
  });
});

test.describe('model kinds', () => {
  test('a model is a chat model unless it says otherwise', async () => {
    const chat = await ws.cp.addModelFromUrl(org(), 'kind-default', HF);
    expect(chat.kind).toBe('chat');
    const res = await ws.cp.send('POST', `/organisations/${org()}/models/from-url`, {
      name: 'kind-explicit-chat',
      url: HF,
      kind: 'chat',
    });
    expect(res.status).toBe(201);
    expect((res.body as ModelInfo).kind).toBe('chat');
  });

  test('an embedding model keeps its kind, in the list and when fetched', async () => {
    const emb = await ws.cp.addModelFromUrl(org(), 'kind-embedding', HF, 'embedding');
    expect(emb.kind).toBe('embedding');
    expect((await ws.cp.getModel(org(), emb.id)).kind).toBe('embedding');
    const list = await ws.cp.send('GET', `/organisations/${org()}/models`);
    expect(list.status).toBe(200);
    const found = (list.body as ModelInfo[]).find((m) => m.id === emb.id);
    expect(found?.kind).toBe('embedding');
  });

  test('an upload carries the kind too, and a bad kind is a 400', async () => {
    const upload = await ws.cp.send('POST', `/organisations/${org()}/models/uploads`, {
      name: 'kind-upload',
      kind: 'embedding',
      fileName: 'e.litertlm',
      sizeBytes: 10,
    });
    expect(upload.status).toBe(201);
    expect((upload.body as { model: ModelInfo }).model.kind).toBe('embedding');
    for (const bad of ['rerank', '', 7]) {
      const res = await ws.cp.send('POST', `/organisations/${org()}/models/from-url`, {
        name: 'kind-bad',
        url: HF,
        kind: bad,
      });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    const badUpload = await ws.cp.send('POST', `/organisations/${org()}/models/uploads`, {
      name: 'kind-bad-upload',
      kind: 'vision',
      fileName: 'e.litertlm',
      sizeBytes: 10,
    });
    expect(badUpload.status).toBe(400);
  });

  test('a benchmark of a pool that serves an embedding model is refused (409)', async () => {
    const placeholder = placeholderModel();
    try {
      const pool = await ws.cp.createPool(org(), 'e2e-embedding-pool');
      const model = await ws.cp.uploadModel(
        org(),
        'bench-embedding',
        placeholder.file,
        'embedding',
      );
      expect(model.status).toBe('ready');
      await ws.cp.assignModel(org(), pool.id, model.id);
      // The model kind is checked before whether a node is online, so no node is needed.
      const res = await ws.cp.send('POST', `/organisations/${org()}/pools/${pool.id}/benchmarks`);
      expect(res.status).toBe(409);
    } finally {
      placeholder.remove();
    }
  });
});

test.describe('audit export', () => {
  const exportUrl = (query = '') => `/organisations/${org()}/audit-logs/export${query}`;
  test("CSV is the default, with a header, an attachment name and the org's rows", async () => {
    await ws.apiKey(); // make sure there is something to export
    const res = await ws.cp.download(exportUrl());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(
      /attachment; filename="audit-log-\d{4}-\d\d-\d\d\.csv"/,
    );
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'occurredAt,source,actorType,actorId,action,entityType,entityId,outcome,ip,metadata',
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(res.text).toContain('organisation.create');
  });

  test('JSON is an array of entries and honours the filters of the list', async () => {
    const all = await ws.cp.download(exportUrl('?format=json'));
    expect(all.status).toBe(200);
    expect(all.headers.get('content-type')).toContain('application/json');
    expect(all.headers.get('content-disposition')).toMatch(/\.json"/);
    const rows = JSON.parse(all.text) as { action: string; entityId: string | null }[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.some((r) => r.action === 'organisation.create' && r.entityId === org())).toBe(true);

    const pools = await ws.cp.download(exportUrl('?format=json&action=pool.'));
    const poolRows = JSON.parse(pools.text) as { action: string }[];
    expect(poolRows.length).toBeGreaterThan(0);
    expect(poolRows.every((r) => r.action.startsWith('pool.'))).toBe(true);
    const none = await ws.cp.download(exportUrl('?format=json&outcome=denied'));
    expect(JSON.parse(none.text)).toEqual([]);
  });

  test("an unknown format is a 400 and another organisation's log is out of reach (404)", async () => {
    expect((await ws.cp.download(exportUrl('?format=xml'))).status).toBe(400);
    const foreign = await ws.cp.download(
      `/organisations/${unknown()}/audit-logs/export?format=csv`,
    );
    expect(foreign.status).toBe(404);
  });
});

test.describe('bulk enrollment', () => {
  const bulk = (poolId: string, body: unknown) =>
    ws.cp.send('POST', `/organisations/${org()}/pools/${poolId}/enrollments/bulk`, body);
  interface Created {
    items: { enrollment: { id: string; poolId: string; expiresAt: string }; code: string }[];
  }

  test('creates one distinct single-use code per device', async () => {
    const pool = await ws.cp.createPool(org(), 'e2e-bulk');
    const res = await bulk(pool.id, { count: 4 });
    expect(res.status).toBe(201);
    const { items } = res.body as Created;
    expect(items).toHaveLength(4);
    expect(new Set(items.map((i) => i.code)).size).toBe(4);
    for (const i of items) {
      expect(i.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{6}$/);
      expect(i.enrollment.poolId).toBe(pool.id);
    }
    // They are real enrollments (listed without their codes) and can be cancelled one by one.
    const listed = await ws.cp.listEnrollments(org(), pool.id);
    expect(listed).toHaveLength(4);
    expect(JSON.stringify(listed)).not.toContain(items[0]!.code);
    await ws.cp.cancelEnrollment(org(), items[0]!.enrollment.id);
    expect(await ws.cp.listEnrollments(org(), pool.id)).toHaveLength(3);
  });

  test('the count is 1 to 50', async () => {
    const pool = await ws.cp.createPool(org(), 'e2e-bulk-bounds');
    for (const count of [0, -1, 51, 1.5, '3', null]) {
      expect((await bulk(pool.id, { count })).status, JSON.stringify(count)).toBe(400);
    }
    expect((await bulk(pool.id, {})).status).toBe(400);
    expect(await ws.cp.listEnrollments(org(), pool.id)).toHaveLength(0);
    expect((await bulk(pool.id, { count: 1 })).status).toBe(201);
    const fifty = await bulk(pool.id, { count: 50 });
    expect(fifty.status).toBe(201);
    expect((fifty.body as Created).items).toHaveLength(50);
  });

  test('an unknown pool is a 404 and the call is audited as one entry', async () => {
    expect((await bulk(unknown(), { count: 2 })).status).toBe(404);
    const pool = await ws.cp.createPool(org(), 'e2e-bulk-audit');
    await bulk(pool.id, { count: 2 });
    const row = await waitFor(
      'the audit row of the bulk call',
      async () => {
        const res = await ws.cp.download(
          `/organisations/${org()}/audit-logs/export?format=json&action=enrollment.create_bulk`,
        );
        const all = JSON.parse(res.text) as {
          entityId: string;
          metadata: { count?: number } | null;
        }[];
        return all.find((r) => r.entityId === pool.id);
      },
      30_000,
      1_000,
    );
    expect(row.metadata?.count).toBe(2);
  });
});

test.describe('API key expiry', () => {
  const patch = (keyId: string, body: unknown) =>
    ws.cp.send('PATCH', `/organisations/${org()}/api-keys/${keyId}`, body);
  const expiry = async (keyId: string) => {
    const list = await ws.cp.send('GET', `/organisations/${org()}/api-keys`);
    return (list.body as { id: string; expiresAt: string | null }[]).find((k) => k.id === keyId)
      ?.expiresAt;
  };

  test('sets a new expiry, and null clears it', async () => {
    const key = await ws.apiKey();
    expect(await expiry(key.id)).toBeNull();
    const when = new Date(Date.now() + 30 * 86_400_000);
    const set = await patch(key.id, { expiresAt: when.toISOString() });
    expect(set.status).toBe(200);
    expect(new Date((set.body as { expiresAt: string }).expiresAt).getTime()).toBe(when.getTime());
    expect(await expiry(key.id)).toBe(when.toISOString());
    const cleared = await patch(key.id, { expiresAt: null });
    expect(cleared.status).toBe(200);
    expect((cleared.body as { expiresAt: string | null }).expiresAt).toBeNull();
    expect(await expiry(key.id)).toBeNull();
  });

  test('a date in the past, a bad date and an empty body are 400', async () => {
    const key = await ws.apiKey();
    const past = new Date(Date.now() - 60_000).toISOString();
    expect((await patch(key.id, { expiresAt: past })).status).toBe(400);
    expect((await patch(key.id, { expiresAt: 'tomorrow' })).status).toBe(400);
    expect((await patch(key.id, {})).status).toBe(400);
    expect(await expiry(key.id)).toBeNull();
  });

  test('changing the expiry keeps the limits, an unknown key is 404, a revoked key cannot be changed', async () => {
    const key = await ws.apiKey({ limits: { requestsPerMinute: 7 } });
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const res = await patch(key.id, { expiresAt: future });
    expect(res.status).toBe(200);
    expect(
      (res.body as { limits: { requestsPerMinute: number | null } }).limits.requestsPerMinute,
    ).toBe(7);
    expect((await patch(unknown(), { expiresAt: future })).status).toBe(404);
    await ws.cp.revokeApiKey(org(), key.id);
    expect((await patch(key.id, { expiresAt: future })).status).toBe(409);
  });
});
