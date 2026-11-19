import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ErrorSchema, UserSchema } from '../dto';
import type { Db } from '../db/client';
import { apiKeys, benchmarks, enrollments, memberships, organisations } from '../db/schema';
import { withParams } from '../errors';

/** Stored in `created_by` columns once the account that created the row is gone. */
export const DELETED_USER = 'deleted';

export const meRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/me',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['users'],
        summary: 'The signed-in user (from the token claims)',
        security: [{ dex: [] }, { bearer: [] }],
        response: { 200: UserSchema, 401: ErrorSchema },
      },
    },
    async (req) => req.user!,
  );

  app.delete(
    '/me',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['users'],
        summary:
          'Delete the signed-in account: removes its memberships and personal references (Dex is untouched)',
        description:
          'There is no users table, so deleting an account removes the memberships of the caller and anonymises ' +
          '`createdBy` on API keys and benchmarks they created; their pending enrollment codes are deleted. ' +
          'Refused with 409 while the caller is the only owner of an organisation.',
        security: [{ dex: [] }, { bearer: [] }],
        response: { 204: z.null(), 401: ErrorSchema, 409: ErrorSchema },
      },
    },
    async (req, reply) => {
      const email = req.user!.email;
      await db.transaction(async (tx) => {
        const mine = await tx
          .select({ orgId: memberships.orgId, role: memberships.role })
          .from(memberships)
          .where(eq(memberships.userEmail, email));
        const ownedIds = mine.filter((m) => m.role === 'owner').map((m) => m.orgId);
        if (ownedIds.length > 0) {
          // Lock every owner row of those organisations so a concurrent role change cannot slip past the check.
          const owners = await tx
            .select({ orgId: memberships.orgId })
            .from(memberships)
            .where(and(inArray(memberships.orgId, ownedIds), eq(memberships.role, 'owner')))
            .for('update');
          const count = new Map<string, number>();
          for (const o of owners) count.set(o.orgId, (count.get(o.orgId) ?? 0) + 1);
          const sole = ownedIds.filter((id) => (count.get(id) ?? 0) <= 1);
          if (sole.length > 0) {
            const names = await tx
              .select({ name: organisations.name })
              .from(organisations)
              .where(inArray(organisations.id, sole));
            throw withParams(app.httpErrors.conflict('errors.accountOwnsOrgs'), {
              orgs: names.map((n) => n.name).join(', '),
            });
          }
        }
        await tx.delete(memberships).where(eq(memberships.userEmail, email));
        await tx.delete(enrollments).where(eq(enrollments.createdBy, email));
        await tx
          .update(apiKeys)
          .set({ createdBy: DELETED_USER })
          .where(eq(apiKeys.createdBy, email));
        await tx
          .update(benchmarks)
          .set({ createdBy: DELETED_USER })
          .where(eq(benchmarks.createdBy, email));
      });
      return reply.code(204).send(null);
    },
  );
};
