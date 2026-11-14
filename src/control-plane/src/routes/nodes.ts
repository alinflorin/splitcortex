import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ErrorSchema,
  NodeParamsSchema,
  NodeSchema,
  PoolNodesParamsSchema,
  UpdateNodeSchema,
  type NodeDto,
} from '../dto';
import { requireOrgRole } from '../access';
import { notifyConfigChange, recordConfigChange } from '../db/config-changes';
import type { Db } from '../db/client';
import { nodeStatus, nodes, pools } from '../db/schema';

/** A node counts as online only while the gateway keeps refreshing its row (it writes every few seconds). */
export const LIVE_STALENESS_MS = 60_000;

type Row = { node: typeof nodes.$inferSelect; live: typeof nodeStatus.$inferSelect | null };

export function toNodeDto({ node, live }: Row, now = Date.now()): NodeDto {
  const fresh = live !== null && now - live.updatedAt.getTime() <= LIVE_STALENESS_MS;
  return {
    id: node.id,
    orgId: node.orgId,
    poolId: node.poolId,
    name: node.name,
    fingerprint: node.fingerprint,
    approved: node.approved,
    status: !node.approved ? 'pending' : live?.connected && fresh ? 'online' : 'offline',
    platform: node.platform,
    deviceModel: node.deviceModel,
    osVersion: node.osVersion,
    appVersion: node.appVersion,
    cpuCores: node.cpuCores,
    memoryTotalMb: node.memoryTotalMb,
    createdAt: node.createdAt.toISOString(),
    // Telemetry of a node that stopped reporting is stale; do not present it as current.
    live:
      live && fresh && live.connected
        ? {
            connectedSince: live.connectedSince?.toISOString() ?? null,
            updatedAt: live.updatedAt.toISOString(),
            cpuPercent: live.cpuPercent,
            memoryUsedMb: live.memoryUsedMb,
            batteryPercent: live.batteryPercent,
            charging: live.charging,
            temperatureC: live.temperatureC,
            inFlight: live.inFlight,
            tokensPerSec: live.tokensPerSec,
          }
        : null,
  };
}

export const nodeRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  const select = () =>
    db
      .select({ node: nodes, live: nodeStatus })
      .from(nodes)
      .leftJoin(nodeStatus, eq(nodeStatus.nodeId, nodes.id));

  app.get(
    '/organisations/:orgId/pools/:poolId/nodes',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['nodes'],
        summary: 'Nodes of a pool, with live status',
        security: [{ dex: [] }, { bearer: [] }],
        params: PoolNodesParamsSchema,
        response: { 200: z.array(NodeSchema), 401: ErrorSchema, 404: ErrorSchema },
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
      const rows = await select()
        .where(and(eq(nodes.poolId, poolId), eq(nodes.orgId, orgId)))
        .orderBy(nodes.createdAt);
      return rows.map((r) => toNodeDto(r));
    },
  );

  app.get(
    '/organisations/:orgId/nodes/:nodeId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['nodes'],
        summary: 'One node with its live status',
        security: [{ dex: [] }, { bearer: [] }],
        params: NodeParamsSchema,
        response: { 200: NodeSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req) => {
      const { orgId, nodeId } = req.params;
      await requireOrgRole(app, db, req, orgId);
      const [row] = await select().where(and(eq(nodes.id, nodeId), eq(nodes.orgId, orgId)));
      if (!row) throw app.httpErrors.notFound('Node not found');
      return toNodeDto(row);
    },
  );

  app.patch(
    '/organisations/:orgId/nodes/:nodeId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['nodes'],
        summary: 'Rename a node or approve it (admin or owner)',
        security: [{ dex: [] }, { bearer: [] }],
        params: NodeParamsSchema,
        body: UpdateNodeSchema,
        response: {
          200: NodeSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req) => {
      const { orgId, nodeId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const result = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(nodes)
          .set(req.body)
          .where(and(eq(nodes.id, nodeId), eq(nodes.orgId, orgId)))
          .returning({ id: nodes.id });
        if (!updated) return null;
        return recordConfigChange(tx, { entityType: 'node', entityId: nodeId, orgId });
      });
      if (result === null) throw app.httpErrors.notFound('Node not found');
      await notifyConfigChange(db, result);
      const [row] = await select().where(eq(nodes.id, nodeId));
      return toNodeDto(row!);
    },
  );

  app.delete(
    '/organisations/:orgId/nodes/:nodeId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['nodes'],
        summary:
          'Revoke a node: deletes its registered key; the gateway closes its connection (admin or owner)',
        security: [{ dex: [] }, { bearer: [] }],
        params: NodeParamsSchema,
        response: { 204: z.null(), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const { orgId, nodeId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const seq = await db.transaction(async (tx) => {
        const deleted = await tx
          .delete(nodes)
          .where(and(eq(nodes.id, nodeId), eq(nodes.orgId, orgId)))
          .returning({ id: nodes.id });
        if (deleted.length === 0) return null;
        return recordConfigChange(tx, { entityType: 'node', entityId: nodeId, orgId });
      });
      if (seq === null) throw app.httpErrors.notFound('Node not found');
      await notifyConfigChange(db, seq);
      return reply.code(204).send(null);
    },
  );
};
