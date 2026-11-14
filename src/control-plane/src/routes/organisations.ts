import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CreateOrganisationSchema,
  ErrorSchema,
  OrgIdParamsSchema,
  OrganisationWithRoleSchema,
  UpdateOrganisationSchema,
} from '../dto';
import { requireOrgRole } from '../access';
import { notifyConfigChange, recordConfigChange } from '../db/config-changes';
import type { Db } from '../db/client';
import { apiKeys, memberships, nodes, organisations, pools } from '../db/schema';
import { isUniqueViolation } from '../errors';

export const organisationRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/organisations',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['organisations'],
        summary: 'Organisations the caller is a member of',
        security: [{ dex: [] }, { bearer: [] }],
        response: { 200: z.array(OrganisationWithRoleSchema), 401: ErrorSchema },
      },
    },
    async (req) => {
      const rows = await db
        .select({ org: organisations, role: memberships.role })
        .from(memberships)
        .innerJoin(organisations, eq(organisations.id, memberships.orgId))
        .where(eq(memberships.userEmail, req.user!.email));
      return rows.map(({ org, role }) => ({
        ...org,
        createdAt: org.createdAt.toISOString(),
        role,
      }));
    },
  );

  app.post(
    '/organisations',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['organisations'],
        summary: 'Create an organisation; the caller becomes its owner',
        security: [{ dex: [] }, { bearer: [] }],
        body: CreateOrganisationSchema,
        response: { 201: OrganisationWithRoleSchema, 401: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (req, reply) => {
      let seq: number;
      let created: typeof organisations.$inferSelect;
      try {
        ({ seq, created } = await db.transaction(async (tx) => {
          const [org] = await tx.insert(organisations).values(req.body).returning();
          await tx
            .insert(memberships)
            .values({ orgId: org!.id, userEmail: req.user!.email, role: 'owner' });
          const seq = await recordConfigChange(tx, {
            entityType: 'organisation',
            entityId: org!.id,
            orgId: org!.id,
          });
          return { seq, created: org! };
        }));
      } catch (err) {
        if (isUniqueViolation(err)) throw app.httpErrors.conflict('Slug already taken');
        throw err;
      }
      await notifyConfigChange(db, seq);
      return reply
        .code(201)
        .send({ ...created, createdAt: created.createdAt.toISOString(), role: 'owner' });
    },
  );

  app.get(
    '/organisations/:orgId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['organisations'],
        summary: 'One organisation, with the caller role',
        security: [{ dex: [] }, { bearer: [] }],
        params: OrgIdParamsSchema,
        response: { 200: OrganisationWithRoleSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req) => {
      const role = await requireOrgRole(app, db, req, req.params.orgId);
      const [org] = await db
        .select()
        .from(organisations)
        .where(eq(organisations.id, req.params.orgId));
      return { ...org!, createdAt: org!.createdAt.toISOString(), role };
    },
  );

  app.patch(
    '/organisations/:orgId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['organisations'],
        summary: 'Rename an organisation or change its slug (admin or owner)',
        security: [{ dex: [] }, { bearer: [] }],
        params: OrgIdParamsSchema,
        body: UpdateOrganisationSchema,
        response: {
          200: OrganisationWithRoleSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (req) => {
      const { orgId } = req.params;
      const role = await requireOrgRole(app, db, req, orgId, 'admin');
      try {
        const { seq, org } = await db.transaction(async (tx) => {
          const [org] = await tx
            .update(organisations)
            .set(req.body)
            .where(eq(organisations.id, orgId))
            .returning();
          const seq = await recordConfigChange(tx, {
            entityType: 'organisation',
            entityId: orgId,
            orgId,
          });
          return { seq, org: org! };
        });
        await notifyConfigChange(db, seq);
        return { ...org, createdAt: org.createdAt.toISOString(), role };
      } catch (err) {
        if (isUniqueViolation(err)) throw app.httpErrors.conflict('Slug already taken');
        throw err;
      }
    },
  );

  app.delete(
    '/organisations/:orgId',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['organisations'],
        summary: 'Delete an organisation with its pools, memberships and usage (owner)',
        security: [{ dex: [] }, { bearer: [] }],
        params: OrgIdParamsSchema,
        response: { 204: z.null(), 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req, reply) => {
      const { orgId } = req.params;
      await requireOrgRole(app, db, req, orgId, 'owner');
      const seq = await db.transaction(async (tx) => {
        // The gateway re-fetches each entity and drops the ones that no longer exist, so record the
        // cascaded pools as well as the organisation itself.
        const poolRows = await tx
          .select({ id: pools.id })
          .from(pools)
          .where(eq(pools.orgId, orgId));
        let last = 0;
        const nodeRows = await tx
          .select({ id: nodes.id })
          .from(nodes)
          .where(eq(nodes.orgId, orgId));
        for (const { id } of nodeRows) {
          last = await recordConfigChange(tx, { entityType: 'node', entityId: id, orgId });
        }
        for (const { id } of poolRows) {
          last = await recordConfigChange(tx, { entityType: 'pool', entityId: id, orgId });
        }
        const keyRows = await tx
          .select({ id: apiKeys.id })
          .from(apiKeys)
          .where(eq(apiKeys.orgId, orgId));
        for (const { id } of keyRows) {
          last = await recordConfigChange(tx, { entityType: 'api_key', entityId: id, orgId });
        }
        await tx.delete(organisations).where(eq(organisations.id, orgId));
        return recordConfigChange(tx, { entityType: 'organisation', entityId: orgId, orgId }).then(
          (s) => Math.max(s, last),
        );
      });
      await notifyConfigChange(db, seq);
      return reply.code(204).send(null);
    },
  );
};
