import { Readable } from 'node:stream';
import { and, desc, eq, gte, like, lt, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  AuditExportQuerySchema,
  AuditPageSchema,
  AuditQuerySchema,
  ErrorSchema,
  OrgIdParamsSchema,
} from '../dto';
import type { AuditEntryDto, AuditQuery } from '../dto';
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

type Filters = Pick<AuditQuery, 'action' | 'actor' | 'outcome' | 'source' | 'from' | 'to'>;

function filterConditions(orgId: string, q: Filters): (SQL | undefined)[] {
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
  return where;
}

const keysetAfter = (c: { at: string; id: string }) =>
  or(
    sql`${auditLogs.occurredAt} < ${c.at}::timestamptz`,
    and(sql`${auditLogs.occurredAt} = ${c.at}::timestamptz`, sql`${auditLogs.id} < ${c.id}::uuid`),
  );

const AT_SQL = sql<string>`to_char(${auditLogs.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const toEntry = (r: typeof auditLogs.$inferSelect): AuditEntryDto => ({
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
});

const EXPORT_BATCH = 1000;
const CSV_COLUMNS = [
  'occurredAt',
  'source',
  'actorType',
  'actorId',
  'action',
  'entityType',
  'entityId',
  'outcome',
  'ip',
  'metadata',
] as const;

/** One CSV cell: quoted, and neutralised when a spreadsheet would read it as a formula. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'string' ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Every matching row, newest first, read in keyset batches so memory stays flat. */
async function* exportRows(db: Db, where: (SQL | undefined)[]): AsyncGenerator<AuditEntryDto> {
  let cursor: { at: string; id: string } | null = null;
  for (;;) {
    const rows: { row: typeof auditLogs.$inferSelect; at: string }[] = await db
      .select({ row: auditLogs, at: AT_SQL })
      .from(auditLogs)
      .where(and(...where, cursor ? keysetAfter(cursor) : undefined))
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
      .limit(EXPORT_BATCH);
    for (const r of rows) yield toEntry(r.row);
    const last = rows[rows.length - 1];
    if (!last || rows.length < EXPORT_BATCH) return;
    cursor = { at: last.at, id: last.row.id };
  }
}

async function* exportChunks(
  rows: AsyncGenerator<AuditEntryDto>,
  format: 'csv' | 'json',
): AsyncGenerator<string> {
  if (format === 'csv') yield CSV_COLUMNS.join(',') + '\r\n';
  else yield '[';
  let first = true;
  for await (const e of rows) {
    if (format === 'csv') yield CSV_COLUMNS.map((c) => csvCell(e[c])).join(',') + '\r\n';
    else yield (first ? '\n' : ',\n') + JSON.stringify(e);
    first = false;
  }
  if (format === 'json') yield first ? ']\n' : '\n]\n';
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

      const where = filterConditions(orgId, q);
      if (q.cursor) {
        const c = decodeCursor(q.cursor);
        if (!c) throw app.httpErrors.badRequest('errors.invalidCursor');
        where.push(keysetAfter(c));
      }

      const rows = await db
        .select({ row: auditLogs, at: AT_SQL })
        .from(auditLogs)
        .where(and(...where))
        .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit).map((r) => ({ ...r.row, at: r.at }));
      const last = page[page.length - 1];
      return {
        items: page.map(toEntry),
        nextCursor:
          rows.length > q.limit && last
            ? Buffer.from(`${last.at}|${last.id}`).toString('base64url')
            : null,
      };
    },
  );

  app.get(
    '/organisations/:orgId/audit-logs/export',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['audit'],
        summary:
          'Download the audit log (CSV or JSON, newest first) with the same filters as the list (admin or owner)',
        security: [{ dex: [] }, { bearer: [] }],
        params: OrgIdParamsSchema,
        querystring: AuditExportQuerySchema,
      },
    },
    async (req, reply) => {
      const { orgId } = req.params;
      const { format, ...filters } = req.query;
      await requireOrgRole(app, db, req, orgId, 'admin');
      const day = new Date().toISOString().slice(0, 10);
      return reply
        .header('content-type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json')
        .header('content-disposition', `attachment; filename="audit-log-${day}.${format}"`)
        .header('cache-control', 'no-store')
        .send(
          Readable.from(exportChunks(exportRows(db, filterConditions(orgId, filters)), format)),
        );
    },
  );
};
