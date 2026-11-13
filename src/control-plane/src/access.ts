import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { OrgRole } from './dto';
import type { Db } from './db/client';
import { memberships } from './db/schema';

const rank: Record<OrgRole, number> = { member: 0, admin: 1, owner: 2 };

/**
 * Tenant check: the caller's role in the organisation, or 404 when they are not a member
 * (do not reveal that the organisation exists) / 403 when the role is too low.
 */
export async function requireOrgRole(
  app: FastifyInstance,
  db: Db,
  req: FastifyRequest,
  orgId: string,
  minimum: OrgRole = 'member',
): Promise<OrgRole> {
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userEmail, req.user!.email)));
  if (!row) throw app.httpErrors.notFound('Organisation not found');
  if (rank[row.role] < rank[minimum]) throw app.httpErrors.forbidden('Insufficient role');
  return row.role;
}
