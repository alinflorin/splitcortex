import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CreateOrganisationSchema, ErrorSchema, OrganisationWithRoleSchema } from '../dto';
import { notifyConfigChange, recordConfigChange } from '../db/config-changes';
import type { Db } from '../db/client';
import { memberships, organisations } from '../db/schema';
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
};
