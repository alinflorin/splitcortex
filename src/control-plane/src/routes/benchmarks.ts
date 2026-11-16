import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  BenchmarkParamsSchema,
  BenchmarkSchema,
  ErrorSchema,
  PoolNodesParamsSchema,
  type BenchmarkDto,
} from '../dto';
import { requireOrgRole } from '../access';
import type { Db } from '../db/client';
import { benchmarkResults, benchmarks, nodeStatus, nodes, poolModels, pools } from '../db/schema';
import { LIVE_STALENESS_MS } from './nodes';

/** Benchmarks shown per pool; older ones are deleted when a new one starts. */
const KEEP = 10;

type ResultRow = typeof benchmarkResults.$inferSelect;
type Row = typeof benchmarks.$inferSelect;

function toDto(b: Row, results: (ResultRow & { nodeName: string | null })[]): BenchmarkDto {
  const open = results.some((r) => r.status === 'pending' || r.status === 'running');
  return {
    id: b.id,
    orgId: b.orgId,
    poolId: b.poolId,
    createdBy: b.createdBy,
    createdAt: b.createdAt.toISOString(),
    status: open ? 'running' : 'done',
    results: results.map((r) => ({
      nodeId: r.nodeId,
      nodeName: r.nodeName,
      status: r.status as BenchmarkDto['results'][number]['status'],
      error: r.error,
      ttftMs: r.ttftMs,
      totalMs: r.totalMs,
      tokens: r.tokens,
      tokensPerSec: r.tokensPerSec,
    })),
  };
}

export const benchmarkRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  const load = async (poolId: string, ids?: string[]) => {
    const rows = await db
      .select()
      .from(benchmarks)
      .where(
        ids
          ? and(eq(benchmarks.poolId, poolId), inArray(benchmarks.id, ids))
          : eq(benchmarks.poolId, poolId),
      )
      .orderBy(desc(benchmarks.createdAt))
      .limit(KEEP);
    if (rows.length === 0) return [];
    const results = await db
      .select({ r: benchmarkResults, nodeName: nodes.name })
      .from(benchmarkResults)
      .leftJoin(nodes, eq(nodes.id, benchmarkResults.nodeId))
      .where(
        inArray(
          benchmarkResults.benchmarkId,
          rows.map((b) => b.id),
        ),
      );
    return rows.map((b) =>
      toDto(
        b,
        results
          .filter((x) => x.r.benchmarkId === b.id)
          .map((x) => ({ ...x.r, nodeName: x.nodeName }))
          .sort((a, b2) => (a.nodeName ?? '').localeCompare(b2.nodeName ?? '')),
      ),
    );
  };

  const poolOf = async (orgId: string, poolId: string) => {
    const [pool] = await db
      .select({ id: pools.id })
      .from(pools)
      .where(and(eq(pools.id, poolId), eq(pools.orgId, orgId)));
    if (!pool) throw app.httpErrors.notFound('Pool not found');
  };

  app.get(
    '/organisations/:orgId/pools/:poolId/benchmarks',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['benchmarks'],
        summary: 'Latest benchmarks of a pool, newest first',
        security: [{ dex: [] }, { bearer: [] }],
        params: PoolNodesParamsSchema,
        response: { 200: z.array(BenchmarkSchema), 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req) => {
      const { orgId, poolId } = req.params;
      await requireOrgRole(app, db, req, orgId);
      await poolOf(orgId, poolId);
      return load(poolId);
    },
  );

  app.post(
    '/organisations/:orgId/pools/:poolId/benchmarks',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['benchmarks'],
        summary:
          'Benchmark every online node of the pool with a fixed prompt (admin or owner); the gateways run it and fill in the results',
        security: [{ dex: [] }, { bearer: [] }],
        params: PoolNodesParamsSchema,
        response: {
          201: BenchmarkSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { orgId, poolId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      await poolOf(orgId, poolId);
      const [assigned] = await db
        .select({ modelId: poolModels.modelId })
        .from(poolModels)
        .where(eq(poolModels.poolId, poolId));
      if (!assigned) throw app.httpErrors.conflict('The pool serves no model yet');
      const online = await db
        .select({ id: nodes.id })
        .from(nodes)
        .innerJoin(nodeStatus, eq(nodeStatus.nodeId, nodes.id))
        .where(
          and(
            eq(nodes.poolId, poolId),
            eq(nodes.approved, true),
            eq(nodeStatus.connected, true),
            sql`${nodeStatus.updatedAt} > now() - ${LIVE_STALENESS_MS / 1000} * interval '1 second'`,
          ),
        );
      if (online.length === 0) throw app.httpErrors.conflict('No node of this pool is online');
      const [open] = await db
        .select({ id: benchmarkResults.id })
        .from(benchmarkResults)
        .innerJoin(benchmarks, eq(benchmarks.id, benchmarkResults.benchmarkId))
        .where(
          and(
            eq(benchmarks.poolId, poolId),
            inArray(benchmarkResults.status, ['pending', 'running']),
            sql`${benchmarks.createdAt} > now() - interval '5 minutes'`,
          ),
        )
        .limit(1);
      if (open) throw app.httpErrors.conflict('A benchmark of this pool is still running');

      const id = await db.transaction(async (tx) => {
        const [b] = await tx
          .insert(benchmarks)
          .values({ orgId, poolId, createdBy: req.user!.email })
          .returning();
        await tx
          .insert(benchmarkResults)
          .values(online.map((n) => ({ benchmarkId: b!.id, nodeId: n.id })));
        // Keep the newest few.
        await tx.execute(sql`delete from benchmarks where pool_id = ${poolId} and id not in (
          select id from benchmarks where pool_id = ${poolId} order by created_at desc limit ${KEEP})`);
        return b!.id;
      });
      const [created] = await load(poolId, [id]);
      return reply.code(201).send(created!);
    },
  );

  app.delete(
    '/organisations/:orgId/pools/:poolId/benchmarks/:benchmarkId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['benchmarks'],
        summary: 'Delete a benchmark (admin or owner)',
        security: [{ dex: [] }, { bearer: [] }],
        params: BenchmarkParamsSchema,
        response: { 204: z.null(), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const { orgId, poolId, benchmarkId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const gone = await db
        .delete(benchmarks)
        .where(
          and(
            eq(benchmarks.id, benchmarkId),
            eq(benchmarks.poolId, poolId),
            eq(benchmarks.orgId, orgId),
          ),
        )
        .returning({ id: benchmarks.id });
      if (gone.length === 0) throw app.httpErrors.notFound('Benchmark not found');
      return reply.code(204).send(null);
    },
  );
};
