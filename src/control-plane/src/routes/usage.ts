import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ErrorSchema, OrgIdParamsSchema, UsageQuerySchema, UsageSchema } from '../dto';
import { requireOrgRole } from '../access';
import type { Db } from '../db/client';
import { usageRecords } from '../db/schema';

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 92;

export const usageRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/organisations/:orgId/usage',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['usage'],
        summary: 'Token usage of an organisation over time (any member)',
        security: [{ dex: [] }, { bearer: [] }],
        params: OrgIdParamsSchema,
        querystring: UsageQuerySchema,
        response: { 200: UsageSchema, 400: ErrorSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req) => {
      const { orgId } = req.params;
      const { granularity, groupBy, poolId, model } = req.query;
      await requireOrgRole(app, db, req, orgId);

      const to = req.query.to ? new Date(req.query.to) : new Date();
      const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 7 * DAY_MS);
      if (from >= to) throw app.httpErrors.badRequest('`from` must be before `to`');
      if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS)
        throw app.httpErrors.badRequest(`Range is limited to ${MAX_RANGE_DAYS} days`);

      const bucket = sql<Date>`date_trunc(${sql.raw(`'${granularity}'`)}, ${usageRecords.bucket} at time zone 'UTC') at time zone 'UTC'`;
      const group =
        groupBy === 'pool'
          ? sql<string>`${usageRecords.poolId}::text`
          : groupBy === 'key'
            ? sql<string>`${usageRecords.keyId}::text`
            : groupBy === 'model'
              ? sql<string>`${usageRecords.model}`
              : sql<null>`null`;

      const rows = await db
        .select({
          bucket,
          group,
          tokensIn: sql<string>`sum(${usageRecords.tokensIn})`,
          tokensOut: sql<string>`sum(${usageRecords.tokensOut})`,
          requests: sql<string>`sum(${usageRecords.requests})`,
          errors: sql<string>`sum(${usageRecords.errors})`,
        })
        .from(usageRecords)
        .where(
          and(
            eq(usageRecords.orgId, orgId),
            gte(usageRecords.bucket, from),
            lt(usageRecords.bucket, to),
            poolId ? eq(usageRecords.poolId, poolId) : undefined,
            model ? eq(usageRecords.model, model) : undefined,
          ),
        )
        .groupBy(sql`1`, sql`2`)
        .orderBy(sql`1`, sql`2`);

      const totals = { tokensIn: 0, tokensOut: 0, requests: 0, errors: 0 };
      const series = rows.map((r) => {
        const point = {
          bucket: new Date(r.bucket).toISOString(),
          group: r.group,
          tokensIn: Number(r.tokensIn),
          tokensOut: Number(r.tokensOut),
          requests: Number(r.requests),
          errors: Number(r.errors),
        };
        totals.tokensIn += point.tokensIn;
        totals.tokensOut += point.tokensOut;
        totals.requests += point.requests;
        totals.errors += point.errors;
        return point;
      });
      return { from: from.toISOString(), to: to.toISOString(), granularity, totals, series };
    },
  );
};
