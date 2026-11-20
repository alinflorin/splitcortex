import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ErrorSchema,
  LATENCY_BOUNDS_MS,
  LATENCY_BUCKETS,
  MetricsQuerySchema,
  MetricsSchema,
  OrgIdParamsSchema,
  type MetricsStep,
  type NodeMetricPointDto,
  type PoolMetricPointDto,
} from '../dto';
import { requireOrgRole } from '../access';
import type { Db } from '../db/client';
import { withParams } from '../errors';
import { nodeMetrics, poolMetrics, usageRecords } from '../db/schema';

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 7;
const STEP_SECONDS: Record<MetricsStep, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600 };

/** The smallest step that keeps the series around 240 points. */
function autoStep(rangeMs: number): MetricsStep {
  for (const s of ['1m', '5m', '15m'] as const)
    if (rangeMs / (STEP_SECONDS[s] * 1000) <= 240) return s;
  return '1h';
}

/** The upper bound of the histogram bucket that holds the given percentile; null without samples. */
export function percentileMs(hist: number[], p: number): number | null {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const rank = Math.ceil(total * p);
  let seen = 0;
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i] ?? 0;
    if (seen >= rank) return LATENCY_BOUNDS_MS[Math.min(i, LATENCY_BOUNDS_MS.length - 1)]!;
  }
  return LATENCY_BOUNDS_MS[LATENCY_BOUNDS_MS.length - 1]!;
}

const num = (v: string | number | null) => (v === null ? null : Number(v));

export const metricsRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/organisations/:orgId/metrics',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['metrics'],
        summary:
          'Operational metrics of an organisation over time: per-pool gateway numbers and node telemetry (any member)',
        security: [{ dex: [] }, { bearer: [] }],
        params: OrgIdParamsSchema,
        querystring: MetricsQuerySchema,
        response: { 200: MetricsSchema, 400: ErrorSchema, 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (req) => {
      const { orgId } = req.params;
      const { poolId, nodeId } = req.query;
      await requireOrgRole(app, db, req, orgId);

      const to = req.query.to ? new Date(req.query.to) : new Date();
      const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 3_600_000);
      if (from >= to) throw app.httpErrors.badRequest('errors.fromBeforeTo');
      if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS)
        throw withParams(app.httpErrors.badRequest('errors.rangeLimit'), { days: MAX_RANGE_DAYS });
      const step = req.query.step ?? autoStep(to.getTime() - from.getTime());
      const secs = STEP_SECONDS[step];
      const slot = (col: unknown) =>
        sql<Date>`to_timestamp(floor(extract(epoch from ${col}) / ${secs}) * ${secs})`;

      // ---- pools: histograms are added up per step here (small rows, bounded range), counters in SQL.
      const metricRows = await db
        .select({
          bucket: slot(poolMetrics.bucket),
          rateLimited: sql<string>`sum(${poolMetrics.rateLimited})`,
          unavailable: sql<string>`sum(${poolMetrics.unavailable})`,
          peak: sql<number>`max(${poolMetrics.peakInFlight})`,
          // Histograms add up bucket by bucket (Postgres arrays are 1-based).
          ...Object.fromEntries(
            Array.from({ length: LATENCY_BUCKETS }, (_, i) => [
              [`l${i}`, sql<string>`coalesce(sum(${poolMetrics.latencyHist}[${i + 1}]), 0)`],
              [`t${i}`, sql<string>`coalesce(sum(${poolMetrics.ttftHist}[${i + 1}]), 0)`],
            ]).flat(),
          ),
        })
        .from(poolMetrics)
        .where(
          and(
            eq(poolMetrics.orgId, orgId),
            gte(poolMetrics.bucket, from),
            lt(poolMetrics.bucket, to),
            poolId ? eq(poolMetrics.poolId, poolId) : undefined,
          ),
        )
        .groupBy(sql`1`);
      const usageRows = await db
        .select({
          bucket: slot(usageRecords.bucket),
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
          ),
        )
        .groupBy(sql`1`);

      const points = new Map<string, PoolMetricPointDto>();
      const point = (b: Date | string): PoolMetricPointDto => {
        const key = new Date(b).toISOString();
        let p = points.get(key);
        if (!p) {
          p = {
            bucket: key,
            requests: 0,
            errors: 0,
            tokensIn: 0,
            tokensOut: 0,
            rateLimited: 0,
            unavailable: 0,
            peakInFlight: 0,
            latencyP50Ms: null,
            latencyP95Ms: null,
            ttftP50Ms: null,
            ttftP95Ms: null,
          };
          points.set(key, p);
        }
        return p;
      };
      const hist = (r: Record<string, unknown>, prefix: 'l' | 't') =>
        Array.from({ length: LATENCY_BUCKETS }, (_, i) => Number(r[`${prefix}${i}`] ?? 0));
      for (const r of metricRows) {
        const p = point(r.bucket);
        p.rateLimited = Number(r.rateLimited);
        p.unavailable = Number(r.unavailable);
        p.peakInFlight = Number(r.peak);
        const lat = hist(r, 'l');
        const ttft = hist(r, 't');
        p.latencyP50Ms = percentileMs(lat, 0.5);
        p.latencyP95Ms = percentileMs(lat, 0.95);
        p.ttftP50Ms = percentileMs(ttft, 0.5);
        p.ttftP95Ms = percentileMs(ttft, 0.95);
      }
      for (const r of usageRows) {
        const p = point(r.bucket);
        p.requests = Number(r.requests);
        p.errors = Number(r.errors);
        p.tokensIn = Number(r.tokensIn);
        p.tokensOut = Number(r.tokensOut);
      }

      // ---- nodes: averaged per step; the in-flight count is the average of the per-minute totals.
      const nodeRows = await db
        .select({
          bucket: slot(nodeMetrics.bucket),
          nodes: sql<string>`count(distinct ${nodeMetrics.nodeId})`,
          cpu: sql<string | null>`avg(${nodeMetrics.cpuPercent})`,
          mem: sql<string | null>`avg(${nodeMetrics.memoryUsedMb})`,
          battery: sql<string | null>`min(${nodeMetrics.batteryPercent})`,
          temp: sql<string | null>`max(${nodeMetrics.temperatureC})`,
          inFlight: sql<string>`sum(${nodeMetrics.inFlight})::float / count(distinct ${nodeMetrics.bucket})`,
          tps: sql<
            string | null
          >`avg(${nodeMetrics.tokensPerSec}) filter (where ${nodeMetrics.tokensPerSec} > 0)`,
          requests: sql<string>`sum(${nodeMetrics.requests})`,
          failures: sql<string>`sum(${nodeMetrics.failures})`,
          genTokens: sql<string>`sum(${nodeMetrics.genTokens})`,
          genMs: sql<string>`sum(${nodeMetrics.genMs})`,
        })
        .from(nodeMetrics)
        .where(
          and(
            eq(nodeMetrics.orgId, orgId),
            gte(nodeMetrics.bucket, from),
            lt(nodeMetrics.bucket, to),
            poolId ? eq(nodeMetrics.poolId, poolId) : undefined,
            nodeId ? eq(nodeMetrics.nodeId, nodeId) : undefined,
          ),
        )
        .groupBy(sql`1`)
        .orderBy(sql`1`);

      return {
        from: from.toISOString(),
        to: to.toISOString(),
        step,
        pools: [...points.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
        nodes: nodeRows.map((r): NodeMetricPointDto => ({
          bucket: new Date(r.bucket).toISOString(),
          nodesReporting: Number(r.nodes),
          cpuPercent: num(r.cpu),
          memoryUsedMb: num(r.mem),
          batteryPercent: num(r.battery),
          temperatureC: num(r.temp),
          inFlight: Number(r.inFlight),
          tokensPerSec: num(r.tps),
          requests: Number(r.requests),
          failures: Number(r.failures),
          // tokens per second over the whole step: total tokens / total generation time
          measuredTokensPerSec:
            Number(r.genMs) > 0 ? (Number(r.genTokens) * 1000) / Number(r.genMs) : null,
        })),
      };
    },
  );
};
