import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiKeyParamsSchema,
  ApiKeySchema,
  CreateApiKeySchema,
  CreatedApiKeySchema,
  ErrorSchema,
  OrgIdParamsSchema,
  UpdateApiKeySchema,
} from '../dto';
import { limitColumns, limitsOf } from '../limits';
import { requireOrgRole } from '../access';
import { notifyConfigChange, recordConfigChange } from '../db/config-changes';
import type { Db } from '../db/client';
import { apiKeyPools, apiKeys, pools } from '../db/schema';

const TOKEN_PREFIX = 'sc_';
const DISPLAY_PREFIX_LENGTH = 10;

/** Same function the gateway uses to look a key up: SHA-256 of the whole token, hex. */
export const hashApiKey = (token: string) => createHash('sha256').update(token).digest('hex');

const toDto = (k: typeof apiKeys.$inferSelect, poolIds: string[]) => ({
  id: k.id,
  orgId: k.orgId,
  name: k.name,
  prefix: k.prefix,
  allPools: k.allPools,
  poolIds,
  expiresAt: k.expiresAt?.toISOString() ?? null,
  createdBy: k.createdBy,
  lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  revokedAt: k.revokedAt?.toISOString() ?? null,
  limits: limitsOf(k),
  createdAt: k.createdAt.toISOString(),
});

export const apiKeyRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/organisations/:orgId/api-keys',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['api keys'],
        summary: 'API keys of an organisation (admin or owner)',
        security: [{ dex: [] }, { bearer: [] }],
        params: OrgIdParamsSchema,
        response: {
          200: z.array(ApiKeySchema),
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req) => {
      const { orgId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const keys = await db.select().from(apiKeys).where(eq(apiKeys.orgId, orgId));
      const links = await db
        .select({ keyId: apiKeyPools.keyId, poolId: apiKeyPools.poolId })
        .from(apiKeyPools)
        .innerJoin(apiKeys, eq(apiKeys.id, apiKeyPools.keyId))
        .where(eq(apiKeys.orgId, orgId));
      return keys
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((k) =>
          toDto(
            k,
            links.filter((l) => l.keyId === k.id).map((l) => l.poolId),
          ),
        );
    },
  );

  app.post(
    '/organisations/:orgId/api-keys',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['api keys'],
        summary: 'Create an API key (admin or owner); the secret is returned once',
        security: [{ dex: [] }, { bearer: [] }],
        params: OrgIdParamsSchema,
        body: CreateApiKeySchema,
        response: {
          201: CreatedApiKeySchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { orgId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const { name, scope, expiresAt, limits } = req.body;
      const poolIds = scope === 'pools' ? [...new Set(req.body.poolIds)] : [];
      const expires = expiresAt ? new Date(expiresAt) : null;
      if (expires && expires.getTime() <= Date.now())
        throw app.httpErrors.badRequest('errors.expiryInPast');
      if (poolIds.length > 0) {
        const found = await db
          .select({ id: pools.id })
          .from(pools)
          .where(and(eq(pools.orgId, orgId), inArray(pools.id, poolIds)));
        if (found.length !== poolIds.length) throw app.httpErrors.badRequest('errors.unknownPool');
      }

      const secret = TOKEN_PREFIX + randomBytes(32).toString('base64url');
      const { seq, key } = await db.transaction(async (tx) => {
        const [key] = await tx
          .insert(apiKeys)
          .values({
            orgId,
            name,
            prefix: secret.slice(0, DISPLAY_PREFIX_LENGTH),
            hash: hashApiKey(secret),
            allPools: scope === 'org',
            expiresAt: expires,
            createdBy: req.user!.email,
            ...(limits && limitColumns(limits)),
          })
          .returning();
        if (poolIds.length > 0)
          await tx
            .insert(apiKeyPools)
            .values(poolIds.map((poolId) => ({ keyId: key!.id, poolId })));
        const seq = await recordConfigChange(tx, {
          entityType: 'api_key',
          entityId: key!.id,
          orgId,
        });
        return { seq, key: key! };
      });
      await notifyConfigChange(db, seq);
      return reply.code(201).send({ key: toDto(key, poolIds), secret });
    },
  );

  app.patch(
    '/organisations/:orgId/api-keys/:keyId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['api keys'],
        summary:
          'Change the rate limits and/or expiry of an API key (admin or owner); null clears either',
        security: [{ dex: [] }, { bearer: [] }],
        params: ApiKeyParamsSchema,
        body: UpdateApiKeySchema,
        response: {
          200: ApiKeySchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (req) => {
      const { orgId, keyId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const { limits, expiresAt } = req.body;
      const expires =
        expiresAt === undefined ? undefined : expiresAt === null ? null : new Date(expiresAt);
      if (expires && expires.getTime() <= Date.now())
        throw app.httpErrors.badRequest('errors.expiryInPast');
      const result = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ revokedAt: apiKeys.revokedAt })
          .from(apiKeys)
          .where(and(eq(apiKeys.id, keyId), eq(apiKeys.orgId, orgId)))
          .for('update');
        if (!existing) return null;
        // A revoked key stays revoked: changing its expiry must not look like bringing it back.
        if (existing.revokedAt) return 'revoked' as const;
        const [key] = await tx
          .update(apiKeys)
          .set({
            ...(limits && limitColumns(limits)),
            ...(expires !== undefined && { expiresAt: expires }),
          })
          .where(eq(apiKeys.id, keyId))
          .returning();
        if (!key) return null;
        const seq = await recordConfigChange(tx, { entityType: 'api_key', entityId: keyId, orgId });
        const links = await tx
          .select({ poolId: apiKeyPools.poolId })
          .from(apiKeyPools)
          .where(eq(apiKeyPools.keyId, keyId));
        return { seq, key, poolIds: links.map((l) => l.poolId) };
      });
      if (!result) throw app.httpErrors.notFound('errors.apiKeyNotFound');
      if (result === 'revoked') throw app.httpErrors.conflict('errors.apiKeyRevoked');
      await notifyConfigChange(db, result.seq);
      return toDto(result.key, result.poolIds);
    },
  );

  app.delete(
    '/organisations/:orgId/api-keys/:keyId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['api keys'],
        summary: 'Revoke an API key (admin or owner); revoking twice is a no-op',
        security: [{ dex: [] }, { bearer: [] }],
        params: ApiKeyParamsSchema,
        response: { 204: z.null(), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const { orgId, keyId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const result = await db.transaction(async (tx) => {
        const [key] = await tx
          .select({ id: apiKeys.id })
          .from(apiKeys)
          .where(and(eq(apiKeys.id, keyId), eq(apiKeys.orgId, orgId)));
        if (!key) return null;
        const revoked = await tx
          .update(apiKeys)
          .set({ revokedAt: new Date() })
          .where(and(eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt)))
          .returning({ id: apiKeys.id });
        if (revoked.length === 0) return { seq: undefined };
        return {
          seq: await recordConfigChange(tx, { entityType: 'api_key', entityId: keyId, orgId }),
        };
      });
      if (!result) throw app.httpErrors.notFound('errors.apiKeyNotFound');
      if (result.seq !== undefined) await notifyConfigChange(db, result.seq);
      return reply.code(204).send(null);
    },
  );
};
