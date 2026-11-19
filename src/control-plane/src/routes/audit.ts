import { and, desc, eq, gte, like, lt, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AuditPageSchema, AuditQuerySchema, ErrorSchema, OrgIdParamsSchema } from '../dto';
import type { AuditEntryDto } from '../dto';
import { requireOrgRole } from '../access';
import type { Db } from '../db/client';
import { auditLogs } from '../db/schema';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Cursor = microsecond-exact timestamp (JS dates only have milliseconds) + id of the last row of the page. */
const CURSOR = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z)\|([0-9a-f-]{36})$/i;
function decodeCursor(cursor: string): { at: string; id: string } | null {
  const m = CURSOR.exec(Buffer.from(cursor, 'base64url').toString());
  return m ? { at: m[1]!, id: m[2]! } : null;
}

export const auditRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/organisations/:orgId/audit-logs',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['audit'],
        summary: 'Audit log of an organisation, newest first (admin or owner)',
        security: [{ dex: [] }, { bearer: [] }],
        params: OrgIdParamsSchema,
        querystring: AuditQuerySchema,
        response: {
          200: AuditPageSchema,
          400: ErrorSchema,
          401: ErrorSchema,
          403: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (req) => {
      const { orgId } = req.params;
      const q = req.query;
      await requireOrgRole(app, db, req, orgId, 'admin');

      const where: (SQL | undefined)[] = [eq(auditLogs.orgId, orgId)];
      if (q.action)
        where.push(
          q.action.endsWith('.')
            ? like(auditLogs.action, `${escapeLike(q.action)}%`)
            : eq(auditLogs.action, q.action),
        );
      if (q.actor) where.push(eq(auditLogs.actorId, q.actor.toLowerCase()));
      if (q.outcome) where.push(eq(auditLogs.outcome, q.outcome));
      if (q.source) where.push(eq(auditLogs.source, q.source));
      if (q.from) where.push(gte(auditLogs.occurredAt, new Date(q.from)));
      if (q.to) where.push(lt(auditLogs.occurredAt, new Date(q.to)));
      if (q.cursor) {
        const c = decodeCursor(q.cursor);
        if (!c) throw app.httpErrors.badRequest('errors.invalidCursor');
        where.push(
          or(
            sql`${auditLogs.occurredAt} < ${c.at}::timestamptz`,
            and(
              sql`${auditLogs.occurredAt} = ${c.at}::timestamptz`,
              sql`${auditLogs.id} < ${c.id}::uuid`,
            ),
          ),
        );
      }

      const rows = await db
        .select({
          row: auditLogs,
          at: sql<string>`to_char(${auditLogs.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(auditLogs)
        .where(and(...where))
        .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit).map((r) => ({ ...r.row, at: r.at }));
      const last = page[page.length - 1];
      return {
        items: page.map((r): AuditEntryDto => ({
          id: r.id,
          occurredAt: r.occurredAt.toISOString(),
          source: r.source as AuditEntryDto['source'],
          actorType: r.actorType as AuditEntryDto['actorType'],
          actorId: r.actorId,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          outcome: r.outcome as AuditEntryDto['outcome'],
          ip: r.ip,
          metadata: r.metadata,
        })),
        nextCursor:
          rows.length > q.limit && last
            ? Buffer.from(`${last.at}|${last.id}`).toString('base64url')
            : null,
      };
    },
  );
};
