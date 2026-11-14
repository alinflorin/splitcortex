import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CreatePoolSchema,
  ErrorSchema,
  OrgIdParamsSchema,
  PoolParamsSchema,
  PoolSchema,
  UpdatePoolSchema,
} from '../dto';
import { requireOrgRole } from '../access';
import { notifyConfigChange, recordConfigChange } from '../db/config-changes';
import type { Db } from '../db/client';
import { pools } from '../db/schema';
import { isUniqueViolation } from '../errors';

const toDto = (p: typeof pools.$inferSelect) => ({ ...p, createdAt: p.createdAt.toISOString() });

export const poolRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/organisations/:orgId/pools',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['pools'],
        summary: 'Pools of an organisation',
        security: [{ dex: [] }, { bearer: [] }],
        params: OrgIdParamsSchema,
        response: { 200: z.array(PoolSchema), 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req) => {
      await requireOrgRole(app, db, req, req.params.orgId);
      return (await db.select().from(pools).where(eq(pools.orgId, req.params.orgId))).map(toDto);
    },
  );

  app.post(
    '/organisations/:orgId/pools',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['pools'],
        summary: 'Create a pool (admin or owner)',
        security: [{ dex: [] }, { bearer: [] }],
        params: OrgIdParamsSchema,
        body: CreatePoolSchema,
        response: {
          201: PoolSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { orgId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      try {
        const { seq, pool } = await db.transaction(async (tx) => {
          const [pool] = await tx
            .insert(pools)
            .values({ ...req.body, orgId })
            .returning();
          const seq = await recordConfigChange(tx, {
            entityType: 'pool',
            entityId: pool!.id,
            orgId,
          });
          return { seq, pool: pool! };
        });
        await notifyConfigChange(db, seq);
        return reply.code(201).send(toDto(pool));
      } catch (err) {
        if (isUniqueViolation(err))
          throw app.httpErrors.conflict('A pool with this name already exists');
        throw err;
      }
    },
  );

  app.get(
    '/organisations/:orgId/pools/:poolId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['pools'],
        summary: 'One pool',
        security: [{ dex: [] }, { bearer: [] }],
        params: PoolParamsSchema,
        response: { 200: PoolSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req) => {
      const { orgId, poolId } = req.params;
      await requireOrgRole(app, db, req, orgId);
      const [pool] = await db
        .select()
        .from(pools)
        .where(and(eq(pools.id, poolId), eq(pools.orgId, orgId)));
      if (!pool) throw app.httpErrors.notFound('Pool not found');
      return toDto(pool);
    },
  );

  app.patch(
    '/organisations/:orgId/pools/:poolId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['pools'],
        summary: 'Update a pool (admin or owner)',
        security: [{ dex: [] }, { bearer: [] }],
        params: PoolParamsSchema,
        body: UpdatePoolSchema,
        response: {
          200: PoolSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (req) => {
      const { orgId, poolId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      try {
        const result = await db.transaction(async (tx) => {
          const [pool] = await tx
            .update(pools)
            .set(req.body)
            .where(and(eq(pools.id, poolId), eq(pools.orgId, orgId)))
            .returning();
          if (!pool) return null;
          const seq = await recordConfigChange(tx, { entityType: 'pool', entityId: poolId, orgId });
          return { seq, pool };
        });
        if (!result) throw app.httpErrors.notFound('Pool not found');
        await notifyConfigChange(db, result.seq);
        return toDto(result.pool);
      } catch (err) {
        if (isUniqueViolation(err))
          throw app.httpErrors.conflict('A pool with this name already exists');
        throw err;
      }
    },
  );

  app.delete(
    '/organisations/:orgId/pools/:poolId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['pools'],
        summary: 'Delete a pool (admin or owner)',
        security: [{ dex: [] }, { bearer: [] }],
        params: PoolParamsSchema,
        response: { 204: z.null(), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const { orgId, poolId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const seq = await db.transaction(async (tx) => {
        const deleted = await tx
          .delete(pools)
          .where(and(eq(pools.id, poolId), eq(pools.orgId, orgId)))
          .returning({ id: pools.id });
        if (deleted.length === 0) return null;
        return recordConfigChange(tx, { entityType: 'pool', entityId: poolId, orgId });
      });
      if (seq === null) throw app.httpErrors.notFound('Pool not found');
      await notifyConfigChange(db, seq);
      return reply.code(204).send(null);
    },
  );
};
