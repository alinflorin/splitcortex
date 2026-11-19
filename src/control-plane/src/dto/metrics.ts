import { z } from 'zod';
import { IdSchema } from './common';

/**
 * Upper bounds (ms) of the latency histogram buckets the gateway writes (`pool_metrics.latency_hist` / `ttft_hist`):
 * bucket i counts samples <= LATENCY_BOUNDS_MS[i], the last bucket everything above. **Shared with the gateway
 * (`src/gateway/src/metrics.rs`): change both or neither.**
 */
export const LATENCY_BOUNDS_MS = [100, 250, 500, 1000, 2500, 5000, 10_000, 30_000, 60_000] as const;
export const LATENCY_BUCKETS = LATENCY_BOUNDS_MS.length + 1;

export const MetricsStepSchema = z.enum(['1m', '5m', '15m', '1h']);
export type MetricsStep = z.infer<typeof MetricsStepSchema>;

/** Defaults to the last hour; the range is capped at 7 days. `step` defaults to the smallest that keeps ~240 points. */
export const MetricsQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  step: MetricsStepSchema.optional(),
  poolId: IdSchema.optional(),
  nodeId: IdSchema.optional(),
});
export type MetricsQuery = z.input<typeof MetricsQuerySchema>;

const ms = z.number().int().nullable();

export const PoolMetricPointSchema = z.object({
  /** Start of the step (UTC). */
  bucket: z.iso.datetime(),
  requests: z.number().int(),
  errors: z.number().int(),
  tokensIn: z.number().int(),
  tokensOut: z.number().int(),
  /** Refused by a rate limit (429). */
  rateLimited: z.number().int(),
  /** No node could serve the request (502/503). */
  unavailable: z.number().int(),
  peakInFlight: z.number().int(),
  /** Estimates (upper bound of the histogram bucket holding the percentile); null without samples. */
  latencyP50Ms: ms,
  latencyP95Ms: ms,
  ttftP50Ms: ms,
  ttftP95Ms: ms,
});
export type PoolMetricPointDto = z.infer<typeof PoolMetricPointSchema>;

export const NodeMetricPointSchema = z.object({
  bucket: z.iso.datetime(),
  /** Distinct nodes that reported in the step. */
  nodesReporting: z.number().int(),
  cpuPercent: z.number().nullable(),
  memoryUsedMb: z.number().nullable(),
  /** The lowest battery level among the nodes. */
  batteryPercent: z.number().nullable(),
  /** The highest battery temperature among the nodes. */
  temperatureC: z.number().nullable(),
  /** Average number of requests running on the selected nodes together. */
  inFlight: z.number(),
  tokensPerSec: z.number().nullable(),
});
export type NodeMetricPointDto = z.infer<typeof NodeMetricPointSchema>;

export const MetricsSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  step: MetricsStepSchema,
  pools: z.array(PoolMetricPointSchema),
  nodes: z.array(NodeMetricPointSchema),
});
export type MetricsDto = z.infer<typeof MetricsSchema>;
