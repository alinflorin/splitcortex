import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CompleteModelUploadSchema,
  CreateModelFromUrlSchema,
  CreateModelUploadSchema,
  ErrorSchema,
  ModelParamsSchema,
  ModelPartParamsSchema,
  ModelPartSchema,
  ModelSchema,
  ModelUploadSchema,
  OrgIdParamsSchema,
  PoolModelParamsSchema,
  PoolParamsSchema,
  type ModelDto,
} from '../dto';
import { requireOrgRole } from '../access';
import { notifyConfigChange, recordConfigChange } from '../db/config-changes';
import type { Db, Tx } from '../db/client';
import { models, poolModels, pools } from '../db/schema';
import { isUniqueViolation } from '../errors';
import { fileNameFromUrl, normaliseHuggingFaceUrl } from '../models/hf';
import type { ModelStorage } from '../storage/types';

/**
 * Parts pass through the control plane (and Traefik, whose request read timeout is 60 s by default), so they are small
 * enough to finish quickly on a slow link: 8 MiB (S3 minimum is 5 MiB), grown for huge files to stay below 10,000 parts.
 */
const MIN_PART = 8 * 1024 ** 2;
const MAX_PARTS = 9000; // S3 allows 10,000
const MAX_PART_BYTES = MIN_PART;
export const partSizeFor = (size: number) => Math.max(MIN_PART, Math.ceil(size / MAX_PARTS));

const toDto = (m: typeof models.$inferSelect): ModelDto => ({
  id: m.id,
  orgId: m.orgId,
  name: m.name,
  source: m.source,
  sourceUrl: m.sourceUrl,
  fileName: m.fileName,
  status: m.status,
  error: m.error,
  sizeBytes: m.sizeBytes,
  progressBytes: m.progressBytes,
  sha256: m.sha256,
  createdAt: m.createdAt.toISOString(),
});

const security: { [name: string]: string[] }[] = [{ dex: [] }, { bearer: [] }];

export const modelRoutes: FastifyPluginAsyncZod<{ db: Db; storage: ModelStorage | null }> = async (
  app,
  { db, storage },
) => {
  // Upload parts arrive as a raw stream and are piped to storage, never buffered.
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) =>
    done(null, payload),
  );

  const needStorage = (): ModelStorage => {
    if (!storage) throw app.httpErrors.serviceUnavailable('Model storage is not configured');
    return storage;
  };
  const nameTaken = () => app.httpErrors.conflict('A model with this name already exists');

  const findModel = async (orgId: string, modelId: string) => {
    const [m] = await db
      .select()
      .from(models)
      .where(and(eq(models.id, modelId), eq(models.orgId, orgId)));
    if (!m) throw app.httpErrors.notFound('Model not found');
    return m;
  };

  /** Records `model` and every pool serving it (their model list changed too); returns the last seq. */
  const recordModelChange = async (tx: Tx, orgId: string, modelId: string, withPools: boolean) => {
    let seq = await recordConfigChange(tx, { entityType: 'model', entityId: modelId, orgId });
    if (withPools) {
      const rows = await tx
        .select({ poolId: poolModels.poolId })
        .from(poolModels)
        .where(eq(poolModels.modelId, modelId));
      for (const { poolId } of rows)
        seq = await recordConfigChange(tx, { entityType: 'pool', entityId: poolId, orgId });
    }
    return seq;
  };

  app.get(
    '/organisations/:orgId/models',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['models'],
        summary: 'Models of an organisation',
        security,
        params: OrgIdParamsSchema,
        response: { 200: z.array(ModelSchema), 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req) => {
      await requireOrgRole(app, db, req, req.params.orgId);
      const rows = await db
        .select()
        .from(models)
        .where(eq(models.orgId, req.params.orgId))
        .orderBy(models.createdAt);
      return rows.map(toDto);
    },
  );

  app.get(
    '/organisations/:orgId/models/:modelId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['models'],
        summary: 'One model (poll it while it downloads)',
        security,
        params: ModelParamsSchema,
        response: { 200: ModelSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req) => {
      await requireOrgRole(app, db, req, req.params.orgId);
      return toDto(await findModel(req.params.orgId, req.params.modelId));
    },
  );

  app.post(
    '/organisations/:orgId/models/from-url',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['models'],
        summary:
          'Add a model from a Hugging Face URL; the platform mirrors the file into storage in the background (admin or owner)',
        security,
        params: OrgIdParamsSchema,
        body: CreateModelFromUrlSchema,
        response: {
          201: ModelSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
          503: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { orgId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      needStorage();
      const sourceUrl = normaliseHuggingFaceUrl(req.body.url);
      const fileName = fileNameFromUrl(sourceUrl);
      const id = randomUUID();
      try {
        const [row] = await db
          .insert(models)
          .values({
            id,
            orgId,
            name: req.body.name,
            source: 'huggingface',
            sourceUrl,
            fileName,
            status: 'pending',
            storageKey: `orgs/${orgId}/models/${id}/${fileName}`,
          })
          .returning();
        return reply.code(201).send(toDto(row!));
      } catch (err) {
        if (isUniqueViolation(err)) throw nameTaken();
        throw err;
      }
    },
  );

  app.post(
    '/organisations/:orgId/models/uploads',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['models'],
        summary:
          'Start a browser upload: PUT each part to /parts/:partNumber, then call complete (admin or owner)',
        security,
        params: OrgIdParamsSchema,
        body: CreateModelUploadSchema,
        response: {
          201: ModelUploadSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
          503: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { orgId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const store = needStorage();
      const { name, fileName, sizeBytes } = req.body;
      const id = randomUUID();
      const storageKey = `orgs/${orgId}/models/${id}/${fileName}`;
      try {
        await db.insert(models).values({
          id,
          orgId,
          name,
          source: 'upload',
          fileName,
          sizeBytes,
          status: 'uploading',
          storageKey,
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw nameTaken();
        throw err;
      }
      try {
        const { uploadId } = await store.createMultipart(storageKey);
        const [row] = await db
          .update(models)
          .set({ uploadId })
          .where(eq(models.id, id))
          .returning();
        const partSize = partSizeFor(sizeBytes);
        const partCount = Math.ceil(sizeBytes / partSize);
        return reply.code(201).send({ model: toDto(row!), partSize, partCount });
      } catch (err) {
        await db.delete(models).where(eq(models.id, id)); // do not leave a half-created model behind
        throw err;
      }
    },
  );

  app.put(
    '/organisations/:orgId/models/:modelId/parts/:partNumber',
    {
      onRequest: app.authenticate,
      // Fastify rejects bodies above this before reading them; a part is never larger than the part size.
      bodyLimit: MAX_PART_BYTES * 2,
      schema: {
        tags: ['models'],
        summary:
          'Upload one part (raw bytes, exactly the announced part size) of a browser upload; returns its ETag (admin or owner)',
        security,
        params: ModelPartParamsSchema,
        response: {
          200: ModelPartSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
          503: ErrorSchema,
        },
      },
    },
    async (req) => {
      const { orgId, modelId, partNumber } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const store = needStorage();
      const model = await findModel(orgId, modelId);
      if (model.source !== 'upload' || model.status !== 'uploading' || !model.uploadId)
        throw app.httpErrors.conflict('This model has no upload in progress');
      const total = model.sizeBytes!;
      const partSize = partSizeFor(total);
      const count = Math.ceil(total / partSize);
      if (partNumber > count) throw app.httpErrors.notFound('No such part');
      const expected = partNumber < count ? partSize : total - partSize * (count - 1);
      const length = Number(req.headers['content-length']);
      if (!Number.isInteger(length) || length !== expected)
        throw app.httpErrors.badRequest(`This part must be exactly ${expected} bytes`);
      if (!(req.body as Readable | undefined)?.pipe)
        throw app.httpErrors.unsupportedMediaType('Send the part as application/octet-stream');
      return store.uploadPart(
        model.storageKey,
        model.uploadId,
        partNumber,
        req.body as Readable,
        expected,
      );
    },
  );

  app.post(
    '/organisations/:orgId/models/:modelId/complete',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['models'],
        summary: 'Finish a browser upload after every part was PUT (admin or owner)',
        security,
        params: ModelParamsSchema,
        body: CompleteModelUploadSchema,
        response: {
          200: ModelSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
          503: ErrorSchema,
        },
      },
    },
    async (req) => {
      const { orgId, modelId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const store = needStorage();
      const model = await findModel(orgId, modelId);
      if (model.source !== 'upload' || model.status !== 'uploading' || !model.uploadId)
        throw app.httpErrors.conflict('This model has no upload in progress');

      await store.completeMultipart(model.storageKey, model.uploadId, req.body.parts);
      const stored = await store.head(model.storageKey);
      if (!stored || stored.size !== model.sizeBytes) {
        await store.delete(model.storageKey).catch(() => undefined);
        await db
          .update(models)
          .set({ status: 'failed', error: 'Uploaded size does not match', updatedAt: new Date() })
          .where(eq(models.id, modelId));
        throw app.httpErrors.conflict('Uploaded size does not match the announced size');
      }
      const { seq, row } = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(models)
          .set({
            status: 'ready',
            uploadId: null,
            progressBytes: stored.size,
            updatedAt: new Date(),
          })
          .where(eq(models.id, modelId))
          .returning();
        return { seq: await recordModelChange(tx, orgId, modelId, false), row: row! };
      });
      await notifyConfigChange(db, seq);
      return toDto(row);
    },
  );

  app.post(
    '/organisations/:orgId/models/:modelId/retry',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['models'],
        summary: 'Retry a failed Hugging Face download (admin or owner)',
        security,
        params: ModelParamsSchema,
        response: {
          200: ModelSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (req) => {
      const { orgId, modelId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const model = await findModel(orgId, modelId);
      if (model.source !== 'huggingface' || model.status !== 'failed')
        throw app.httpErrors.conflict('Only failed downloads can be retried');
      const [row] = await db
        .update(models)
        .set({ status: 'pending', error: null, progressBytes: 0, updatedAt: new Date() })
        .where(eq(models.id, modelId))
        .returning();
      return toDto(row!);
    },
  );

  app.delete(
    '/organisations/:orgId/models/:modelId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['models'],
        summary: 'Delete a model and its stored file; pools stop serving it (admin or owner)',
        security,
        params: ModelParamsSchema,
        response: { 204: z.null(), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const { orgId, modelId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const model = await findModel(orgId, modelId);
      const seq = await db.transaction(async (tx) => {
        // Record before the cascade removes the pool links.
        const seq = await recordModelChange(tx, orgId, modelId, true);
        await tx.delete(models).where(eq(models.id, modelId));
        return seq;
      });
      await notifyConfigChange(db, seq);
      // Storage cleanup is best effort after the row is gone (an in-flight mirror notices the missing row and aborts).
      if (storage) {
        if (model.uploadId)
          await storage.abortMultipart(model.storageKey, model.uploadId).catch(() => undefined);
        await storage.delete(model.storageKey).catch(() => undefined);
      }
      return reply.code(204).send(null);
    },
  );

  // Which models a pool serves.
  app.get(
    '/organisations/:orgId/pools/:poolId/models',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['models'],
        summary: 'Models served by a pool',
        security,
        params: PoolParamsSchema,
        response: { 200: z.array(ModelSchema), 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req) => {
      const { orgId, poolId } = req.params;
      await requireOrgRole(app, db, req, orgId);
      const [pool] = await db
        .select({ id: pools.id })
        .from(pools)
        .where(and(eq(pools.id, poolId), eq(pools.orgId, orgId)));
      if (!pool) throw app.httpErrors.notFound('Pool not found');
      const rows = await db
        .select({ model: models })
        .from(poolModels)
        .innerJoin(models, eq(models.id, poolModels.modelId))
        .where(eq(poolModels.poolId, poolId))
        .orderBy(models.name);
      return rows.map((r) => toDto(r.model));
    },
  );

  app.put(
    '/organisations/:orgId/pools/:poolId/models/:modelId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['models'],
        summary: 'Serve a ready model from a pool (admin or owner)',
        security,
        params: PoolModelParamsSchema,
        response: {
          204: z.null(),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { orgId, poolId, modelId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const model = await findModel(orgId, modelId);
      const [pool] = await db
        .select({ id: pools.id })
        .from(pools)
        .where(and(eq(pools.id, poolId), eq(pools.orgId, orgId)));
      if (!pool) throw app.httpErrors.notFound('Pool not found');
      if (model.status !== 'ready') throw app.httpErrors.conflict('The model is not ready yet');
      const seq = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(poolModels)
          .values({ poolId, modelId })
          .onConflictDoNothing()
          .returning({ poolId: poolModels.poolId });
        if (inserted.length === 0) return null; // already assigned: idempotent
        return recordConfigChange(tx, { entityType: 'pool', entityId: poolId, orgId });
      });
      if (seq !== null) await notifyConfigChange(db, seq);
      return reply.code(204).send(null);
    },
  );

  app.delete(
    '/organisations/:orgId/pools/:poolId/models/:modelId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['models'],
        summary: 'Stop serving a model from a pool (admin or owner)',
        security,
        params: PoolModelParamsSchema,
        response: { 204: z.null(), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const { orgId, poolId, modelId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      await findModel(orgId, modelId);
      const seq = await db.transaction(async (tx) => {
        const removed = await tx
          .delete(poolModels)
          .where(and(eq(poolModels.poolId, poolId), eq(poolModels.modelId, modelId)))
          .returning({ poolId: poolModels.poolId });
        if (removed.length === 0) return null;
        return recordConfigChange(tx, { entityType: 'pool', entityId: poolId, orgId });
      });
      if (seq !== null) await notifyConfigChange(db, seq);
      return reply.code(204).send(null);
    },
  );
};
