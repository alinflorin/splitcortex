import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ErrorSchema, NodeModelParamsSchema, NodeModelSchema, NodeSelfSchema } from '../dto';
import type { Db } from '../db/client';
import { models, nodes, organisations, poolModels, pools } from '../db/schema';
import type { ModelStorage } from '../storage/types';

type ByteRange = { start: number; end: number };

/**
 * Parses a single `Range: bytes=…` (RFC 9110). Returns `null` when the header is absent or is a multi-range request (we
 * then serve the whole file, which the RFC allows) and `'invalid'` when it cannot be satisfied.
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return header.trim().startsWith('bytes=') && header.includes(',') ? null : 'invalid';
  const [, a, b] = m;
  if (a === '' && b === '') return 'invalid';
  if (a === '') {
    const suffix = Number(b);
    if (suffix === 0) return 'invalid';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(a);
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  if (start >= size || end < start) return 'invalid';
  return { start, end };
}

/**
 * Device-facing model access. A node downloads the models of its pool straight from the control plane (never from
 * Hugging Face and never from object storage, which is internal only). Authenticated by the node's signature
 * (`plugins/node-auth.ts`); a node only ever sees ready models assigned to its own pool.
 */
export const nodeModelRoutes: FastifyPluginAsyncZod<{
  db: Db;
  storage: ModelStorage | null;
}> = async (app, { db, storage }) => {
  const poolModel = (nodeId: { orgId: string; poolId: string }, modelId?: string) =>
    db
      .select({ model: models })
      .from(poolModels)
      .innerJoin(models, eq(models.id, poolModels.modelId))
      .where(
        and(
          eq(poolModels.poolId, nodeId.poolId),
          eq(models.orgId, nodeId.orgId), // tenant isolation, even though the pool link already implies it
          eq(models.status, 'ready'),
          modelId ? eq(models.id, modelId) : undefined,
        ),
      );

  app.get(
    '/node/me',
    {
      onRequest: app.authenticateNode,
      schema: {
        tags: ['node'],
        summary: 'The calling device: its name, organisation and pool (shown in the node app)',
        response: { 200: NodeSelfSchema, 401: ErrorSchema },
      },
    },
    async (req) => {
      const [row] = await db
        .select({
          node: nodes,
          orgName: organisations.name,
          orgSlug: organisations.slug,
          poolName: pools.name,
        })
        .from(nodes)
        .innerJoin(organisations, eq(organisations.id, nodes.orgId))
        .innerJoin(pools, eq(pools.id, nodes.poolId))
        .where(eq(nodes.id, req.node!.id));
      if (!row) throw app.httpErrors.unauthorized('errors.invalidNodeCredentials');
      return {
        nodeId: row.node.id,
        name: row.node.name,
        orgName: row.orgName,
        orgSlug: row.orgSlug,
        poolName: row.poolName,
        approved: row.node.approved,
        createdAt: row.node.createdAt.toISOString(),
      };
    },
  );

  app.get(
    '/node/models',
    {
      onRequest: app.authenticateNode,
      schema: {
        tags: ['node'],
        summary:
          "Ready models of the calling node's pool, with what is needed to download and verify them",
        response: { 200: z.array(NodeModelSchema), 401: ErrorSchema },
      },
    },
    async (req) => {
      const rows = await poolModel(req.node!);
      return rows.map(({ model: m }) => ({
        id: m.id,
        name: m.name,
        kind: m.kind,
        fileName: m.fileName,
        sizeBytes: m.sizeBytes!,
        sha256: m.sha256,
      }));
    },
  );

  app.get(
    '/node/models/:modelId/file',
    {
      onRequest: app.authenticateNode,
      schema: {
        tags: ['node'],
        summary:
          "Download a model file of the node's pool (streamed; supports a single `Range` so interrupted downloads resume)",
        params: NodeModelParamsSchema,
        response: {
          200: z.unknown(),
          206: z.unknown(),
          401: ErrorSchema,
          404: ErrorSchema,
          416: ErrorSchema,
          503: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      if (!storage) throw app.httpErrors.serviceUnavailable('errors.storageNotConfigured');
      const [row] = await poolModel(req.node!, req.params.modelId);
      if (!row) throw app.httpErrors.notFound('errors.modelNotFound');
      const m = row.model;
      const stored =
        m.sizeBytes !== null ? { size: m.sizeBytes } : await storage.head(m.storageKey);
      if (!stored) throw app.httpErrors.notFound('errors.modelNotFound');

      const range = parseRange(req.headers.range, stored.size);
      if (range === 'invalid')
        return reply
          .code(416)
          .header('content-range', `bytes */${stored.size}`)
          .send({
            statusCode: 416,
            error: 'Range Not Satisfiable',
            message: req.t('errors.invalidRange'),
          });

      reply
        .header('accept-ranges', 'bytes')
        .header('content-type', 'application/octet-stream')
        .header('cache-control', 'private, no-store')
        .header(
          'content-disposition',
          `attachment; filename="${m.fileName.replace(/[^\w.-]/g, '_')}"`,
        );
      if (m.sha256) reply.header('etag', `"${m.sha256}"`).header('x-content-sha256', m.sha256);
      if (range) {
        reply
          .code(206)
          .header('content-range', `bytes ${range.start}-${range.end}/${stored.size}`)
          .header('content-length', range.end - range.start + 1);
        return reply.send(await storage.get(m.storageKey, range));
      }
      reply.header('content-length', stored.size);
      return reply.send(await storage.get(m.storageKey));
    },
  );
};
