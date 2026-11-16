import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configChanges, models, organisations } from '../db/schema';
import { createTestApp } from '../test/harness';
import { sweepAbandonedUploads } from './sweep';

type T = Awaited<ReturnType<typeof createTestApp>>;
let t: T;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const DAY = 24 * 3_600_000;

describe('sweepAbandonedUploads', () => {
  it('removes stale uploads and orphaned multipart uploads, keeps live ones', async () => {
    const [org] = await t.db.insert(organisations).values({ name: 'sw', slug: 'sw' }).returning();
    const storage = t.storage!;
    const start = async (name: string, status: 'uploading' | 'downloading', ageMs: number) => {
      const key = `orgs/${org!.id}/${name}`;
      const { uploadId } = await storage.createMultipart(key);
      storage.initiated.set(uploadId, new Date(Date.now() - ageMs));
      const [m] = await t.db
        .insert(models)
        .values({
          orgId: org!.id,
          name,
          source: status === 'uploading' ? 'upload' : 'huggingface',
          fileName: `${name}.litertlm`,
          status,
          storageKey: key,
          uploadId: status === 'uploading' ? uploadId : null,
          createdAt: new Date(Date.now() - ageMs),
        })
        .returning();
      return { m: m!, uploadId };
    };

    const stale = await start('stale', 'uploading', 2 * DAY);
    const fresh = await start('fresh', 'uploading', 1000);
    const mirroring = await start('mirroring', 'downloading', 3 * DAY);
    const orphanId = (await storage.createMultipart('orgs/x/orphan')).uploadId;
    storage.initiated.set(orphanId, new Date(Date.now() - 2 * DAY));
    const youngOrphan = (await storage.createMultipart('orgs/x/young')).uploadId;

    const res = await sweepAbandonedUploads({ db: t.db, storage, maxAgeMs: DAY });
    expect(res).toEqual({ staleUploads: 1, orphanedUploads: 1 });

    expect(await t.db.select().from(models).where(eq(models.id, stale.m.id))).toHaveLength(0);
    expect(await t.db.select().from(models).where(eq(models.id, fresh.m.id))).toHaveLength(1);
    expect(storage.uploads.has(stale.uploadId)).toBe(false);
    expect(storage.uploads.has(orphanId)).toBe(false);
    for (const kept of [fresh.uploadId, mirroring.uploadId, youngOrphan])
      expect(storage.uploads.has(kept)).toBe(true);
    const feed = await t.db
      .select()
      .from(configChanges)
      .where(eq(configChanges.entityId, stale.m.id));
    expect(feed).toHaveLength(1);

    // idempotent
    expect(await sweepAbandonedUploads({ db: t.db, storage, maxAgeMs: DAY })).toEqual({
      staleUploads: 0,
      orphanedUploads: 0,
    });
  });
});
