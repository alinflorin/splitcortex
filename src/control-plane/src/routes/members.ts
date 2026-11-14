import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AddMemberSchema,
  ErrorSchema,
  MemberParamsSchema,
  MemberSchema,
  OrgIdParamsSchema,
  UpdateMemberSchema,
  type OrgRole,
} from '../dto';
import { requireOrgRole, roleRank } from '../access';
import type { Db } from '../db/client';
import { memberships } from '../db/schema';
import { isUniqueViolation } from '../errors';

const toDto = (m: typeof memberships.$inferSelect) => ({
  email: m.userEmail,
  role: m.role,
  createdAt: m.createdAt.toISOString(),
});

/**
 * Who may change whom: owners manage everyone; admins only manage plain members (they can neither touch
 * admins/owners nor hand out a role above `member`). The last owner can never be demoted or removed.
 */
const canManage = (actor: OrgRole, ...roles: OrgRole[]) =>
  actor === 'owner' || roles.every((r) => roleRank[r] < roleRank[actor]);

export const memberRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/organisations/:orgId/members',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['members'],
        summary: 'Members of an organisation',
        security: [{ dex: [] }, { bearer: [] }],
        params: OrgIdParamsSchema,
        response: { 200: z.array(MemberSchema), 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req) => {
      await requireOrgRole(app, db, req, req.params.orgId);
      const rows = await db
        .select()
        .from(memberships)
        .where(eq(memberships.orgId, req.params.orgId))
        .orderBy(memberships.createdAt);
      return rows.map(toDto);
    },
  );

  app.post(
    '/organisations/:orgId/members',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['members'],
        summary: 'Add a member by email (admin or owner)',
        security: [{ dex: [] }, { bearer: [] }],
        params: OrgIdParamsSchema,
        body: AddMemberSchema,
        response: {
          201: MemberSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (req, reply) => {
      const { orgId } = req.params;
      const actor = await requireOrgRole(app, db, req, orgId, 'admin');
      if (!canManage(actor, req.body.role)) throw app.httpErrors.forbidden('Insufficient role');
      try {
        const [row] = await db
          .insert(memberships)
          .values({ orgId, userEmail: req.body.email, role: req.body.role })
          .returning();
        return reply.code(201).send(toDto(row!));
      } catch (err) {
        if (isUniqueViolation(err)) throw app.httpErrors.conflict('Already a member');
        throw err;
      }
    },
  );

  app.patch(
    '/organisations/:orgId/members/:email',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['members'],
        summary: 'Change a member role (admin or owner)',
        security: [{ dex: [] }, { bearer: [] }],
        params: MemberParamsSchema,
        body: UpdateMemberSchema,
        response: {
          200: MemberSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (req) => {
      const { orgId, email } = req.params;
      const actor = await requireOrgRole(app, db, req, orgId, 'admin');
      return db.transaction(async (tx) => {
        // Lock the owner rows so two concurrent demotions cannot both pass the last-owner check.
        const owners = await tx
          .select({ email: memberships.userEmail })
          .from(memberships)
          .where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'owner')))
          .for('update');
        const [target] = await tx
          .select()
          .from(memberships)
          .where(and(eq(memberships.orgId, orgId), eq(memberships.userEmail, email)));
        if (!target) throw app.httpErrors.notFound('Member not found');
        if (!canManage(actor, target.role, req.body.role))
          throw app.httpErrors.forbidden('Insufficient role');
        if (target.role === 'owner' && req.body.role !== 'owner' && owners.length <= 1)
          throw app.httpErrors.conflict('An organisation needs at least one owner');
        const [row] = await tx
          .update(memberships)
          .set({ role: req.body.role })
          .where(and(eq(memberships.orgId, orgId), eq(memberships.userEmail, email)))
          .returning();
        return toDto(row!);
      });
    },
  );

  app.delete(
    '/organisations/:orgId/members/:email',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['members'],
        summary: 'Remove a member (admin or owner), or leave the organisation yourself',
        security: [{ dex: [] }, { bearer: [] }],
        params: MemberParamsSchema,
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
      const { orgId, email } = req.params;
      const self = email === req.user!.email;
      const actor = await requireOrgRole(app, db, req, orgId, self ? 'member' : 'admin');
      await db.transaction(async (tx) => {
        const owners = await tx
          .select({ email: memberships.userEmail })
          .from(memberships)
          .where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'owner')))
          .for('update');
        const [target] = await tx
          .select()
          .from(memberships)
          .where(and(eq(memberships.orgId, orgId), eq(memberships.userEmail, email)));
        if (!target) throw app.httpErrors.notFound('Member not found');
        if (!self && !canManage(actor, target.role))
          throw app.httpErrors.forbidden('Insufficient role');
        if (target.role === 'owner' && owners.length <= 1)
          throw app.httpErrors.conflict('An organisation needs at least one owner');
        await tx
          .delete(memberships)
          .where(and(eq(memberships.orgId, orgId), eq(memberships.userEmail, email)));
      });
      return reply.code(204).send(null);
    },
  );
};
