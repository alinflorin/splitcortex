import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { notifyConfigChange, recordConfigChange } from '../db/config-changes';
import type { Db } from '../db/client';
import { models } from '../db/schema';
import type { ModelStorage } from './types';

export interface SweepResult {
  /** Browser uploads that were never completed: model row removed, multipart upload aborted. */
  staleUploads: number;
  /** Open multipart uploads in the bucket that no model refers to (a crash between S3 and the database, an interrupted mirror). */
  orphanedUploads: number;
}

/**
 * Cleans up abandoned multipart uploads (run by the `control-plane-sweep` CronJob). Multipart parts are billed and
 * occupy disk until the upload is completed or aborted, so a browser that closed mid-upload leaks space.
 *
 * 1. Models still `uploading` after `maxAgeMs` are deleted (they cannot be in a pool: only ready models can be) and their
 *    upload aborted.
 * 2. Open multipart uploads older than `maxAgeMs` that no model row owns are aborted. Uploads of models being mirrored
 *    from Hugging Face (`pending`/`downloading`) are left alone.
 *
 * Every step is best effort and idempotent; an upload that finishes while the sweep runs simply fails its next call.
 */
export async function sweepAbandonedUploads(opts: {
  db: Db;
  storage: ModelStorage;
  maxAgeMs: number;
  now?: Date;
  log?: (msg: string) => void;
}): Promise<SweepResult> {
  const { db, storage, maxAgeMs, log = () => undefined } = opts;
  const cutoff = new Date((opts.now ?? new Date()).getTime() - maxAgeMs);
  const result: SweepResult = { staleUploads: 0, orphanedUploads: 0 };

  const stale = await db
    .select()
    .from(models)
    .where(and(eq(models.status, 'uploading'), lt(models.createdAt, cutoff)));
  for (const m of stale) {
    const seq = await db.transaction(async (tx) => {
      const gone = await tx
        .delete(models)
        .where(and(eq(models.id, m.id), eq(models.status, 'uploading')))
        .returning({ id: models.id });
      if (gone.length === 0) return null; // completed or deleted meanwhile
      return recordConfigChange(tx, { entityType: 'model', entityId: m.id, orgId: m.orgId });
    });
    if (seq === null) continue;
    await notifyConfigChange(db, seq).catch(() => undefined);
    if (m.uploadId) await storage.abortMultipart(m.storageKey, m.uploadId).catch(() => undefined);
    await storage.delete(m.storageKey).catch(() => undefined);
    result.staleUploads++;
    log(`removed abandoned upload of model ${m.id}`);
  }

  const open = (await storage.listMultipart()).filter((u) => u.initiated < cutoff);
  if (open.length > 0) {
    const owned = await db
      .select({ uploadId: models.uploadId })
      .from(models)
      .where(and(isNotNull(models.uploadId), inArray(models.status, ['uploading'])));
    const ownedIds = new Set(owned.map((o) => o.uploadId));
    const mirroring = await db
      .select({ key: models.storageKey })
      .from(models)
      .where(inArray(models.status, ['pending', 'downloading']));
    const mirroringKeys = new Set(mirroring.map((o) => o.key));
    for (const u of open) {
      if (ownedIds.has(u.uploadId) || mirroringKeys.has(u.key)) continue;
      await storage.abortMultipart(u.key, u.uploadId).catch((err) => {
        log(`could not abort ${u.uploadId}: ${String(err)}`);
      });
      result.orphanedUploads++;
      log(`aborted orphaned multipart upload ${u.uploadId}`);
    }
  }
  return result;
}
