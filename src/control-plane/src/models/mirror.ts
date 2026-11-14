import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { and, eq, lt, sql } from 'drizzle-orm';
import { MAX_MODEL_BYTES } from '../dto';
import { notifyConfigChange, recordConfigChange } from '../db/config-changes';
import type { Db } from '../db/client';
import { models } from '../db/schema';
import type { ModelStorage } from '../storage/types';
import { isAllowedHfHost } from './hf';

export interface MirrorDeps {
  db: Db;
  storage: ModelStorage;
  hfToken?: string;
  fetch?: typeof fetch;
  log?: { info: (o: object, m: string) => void; error: (o: object, m: string) => void };
  /** How often progress is written to the database. */
  progressIntervalMs?: number;
}

const MAX_REDIRECTS = 5;
/** A claimed download whose row has not been touched for this long is considered abandoned (crashed instance). */
const STALE_AFTER_SECONDS = 120;

/**
 * GET with manual redirects: every hop must stay on Hugging Face hosts over https (no SSRF through a crafted
 * redirect), and the token is only ever sent to huggingface.co itself, never to the CDN hosts it redirects to.
 */
async function fetchFromHuggingFace(
  start: string,
  token: string | undefined,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<Response> {
  let url = new URL(start);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'https:' || !isAllowedHfHost(url.hostname))
      throw new Error(`Refusing to download from ${url.hostname}`);
    const headers: Record<string, string> = {};
    if (token && url.hostname === 'huggingface.co') headers.authorization = `Bearer ${token}`;
    const res = await fetchFn(url, { redirect: 'manual', headers, signal });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('Redirect without a location');
      url = new URL(location, url);
      await res.body?.cancel();
      continue;
    }
    if (res.status === 401 || res.status === 403)
      throw new Error('Hugging Face denied access (gated or private model?)');
    if (res.status === 404) throw new Error('File not found on Hugging Face');
    if (!res.ok || !res.body) throw new Error(`Hugging Face answered ${res.status}`);
    return res;
  }
  throw new Error('Too many redirects');
}

/** Claims one pending model (safe across instances) and mirrors it. Returns false when there was nothing to do. */
export async function mirrorNext(deps: MirrorDeps): Promise<boolean> {
  const { db, storage } = deps;
  const fetchFn = deps.fetch ?? fetch;

  await db
    .update(models)
    .set({ status: 'pending', updatedAt: new Date() })
    .where(
      and(
        eq(models.status, 'downloading'),
        lt(models.updatedAt, sql`now() - make_interval(secs => ${STALE_AFTER_SECONDS})`),
      ),
    );

  const model = await db.transaction(async (tx) => {
    const [next] = await tx
      .select()
      .from(models)
      .where(and(eq(models.status, 'pending'), eq(models.source, 'huggingface')))
      .orderBy(models.createdAt)
      .limit(1)
      .for('update', { skipLocked: true });
    if (!next) return null;
    await tx
      .update(models)
      .set({ status: 'downloading', progressBytes: 0, error: null, updatedAt: new Date() })
      .where(eq(models.id, next.id));
    return next;
  });
  if (!model || !model.sourceUrl) return false;

  const abort = new AbortController();
  let received = 0;
  const hash = createHash('sha256');
  // Progress heartbeat; it doubles as the cancellation check (the row disappears when the model is deleted).
  const heartbeat = setInterval(() => {
    void db
      .update(models)
      .set({ progressBytes: received, updatedAt: new Date() })
      .where(and(eq(models.id, model.id), eq(models.status, 'downloading')))
      .returning({ id: models.id })
      .then(
        (rows) => {
          if (rows.length === 0) abort.abort();
        },
        () => undefined,
      );
  }, deps.progressIntervalMs ?? 2000);

  try {
    const res = await fetchFromHuggingFace(model.sourceUrl, deps.hfToken, fetchFn, abort.signal);
    const declared = Number(res.headers.get('content-length')) || null;
    if (declared && declared > MAX_MODEL_BYTES)
      throw new Error('File is larger than the allowed maximum');
    if (declared)
      await db.update(models).set({ sizeBytes: declared }).where(eq(models.id, model.id));

    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > MAX_MODEL_BYTES)
          return cb(new Error('File is larger than the allowed maximum'));
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    const source = Readable.fromWeb(
      res.body as import('node:stream/web').ReadableStream<Uint8Array>,
    );
    source.on('error', (e) => meter.destroy(e));
    const { size } = await storage.put(model.storageKey, source.pipe(meter), {
      signal: abort.signal,
    });
    if (declared && size !== declared)
      throw new Error('Stored size does not match the download size');

    const seq = await db.transaction(async (tx) => {
      const updated = await tx
        .update(models)
        .set({
          status: 'ready',
          sizeBytes: size,
          progressBytes: size,
          sha256: hash.digest('hex'),
          updatedAt: new Date(),
        })
        .where(and(eq(models.id, model.id), eq(models.status, 'downloading')))
        .returning({ id: models.id });
      if (updated.length === 0) throw new Error('Model was deleted during the download');
      return recordConfigChange(tx, {
        entityType: 'model',
        entityId: model.id,
        orgId: model.orgId,
      });
    });
    await notifyConfigChange(db, seq);
    deps.log?.info({ modelId: model.id, size }, 'model mirrored');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Download failed';
    deps.log?.error({ modelId: model.id, err: message }, 'model mirror failed');
    await storage.delete(model.storageKey).catch(() => undefined);
    // If the row is gone (deleted mid-download) there is nothing left to mark.
    await db
      .update(models)
      .set({ status: 'failed', error: message.slice(0, 300), updatedAt: new Date() })
      .where(and(eq(models.id, model.id), eq(models.status, 'downloading')));
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}

/** Polls for pending downloads until stopped. One download at a time per instance. */
export function startMirrorWorker(deps: MirrorDeps, pollMs = 5000): () => Promise<void> {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let current: Promise<unknown> = Promise.resolve();
  const tick = () => {
    if (stopped) return;
    current = mirrorNext(deps)
      .catch((err) => deps.log?.error({ err: String(err) }, 'mirror worker error'))
      .then((worked) => {
        if (!stopped) timer = setTimeout(tick, worked ? 0 : pollMs);
      });
  };
  tick();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    await current;
  };
}
