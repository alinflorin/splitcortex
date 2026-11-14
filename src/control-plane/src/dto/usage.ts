import { z } from 'zod';
import { IdSchema } from './common';

export const UsageGranularitySchema = z.enum(['hour', 'day']);
export const UsageGroupBySchema = z.enum(['pool', 'key', 'model']);

/** Defaults to the last 7 days, bucketed by day; the range is capped at 92 days. */
export const UsageQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  granularity: UsageGranularitySchema.default('day'),
  groupBy: UsageGroupBySchema.optional(),
  poolId: IdSchema.optional(),
  model: z.string().min(1).max(200).optional(),
});
export type UsageQuery = z.input<typeof UsageQuerySchema>;

export const UsageCountersSchema = z.object({
  tokensIn: z.number().int(),
  tokensOut: z.number().int(),
  requests: z.number().int(),
  errors: z.number().int(),
});
export type UsageCountersDto = z.infer<typeof UsageCountersSchema>;

export const UsagePointSchema = UsageCountersSchema.extend({
  /** Start of the hour/day (UTC). */
  bucket: z.iso.datetime(),
  /** Pool id, key id or model name when `groupBy` is set, otherwise null. */
  group: z.string().nullable(),
});
export type UsagePointDto = z.infer<typeof UsagePointSchema>;

export const UsageSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  granularity: UsageGranularitySchema,
  totals: UsageCountersSchema,
  series: z.array(UsagePointSchema),
});
export type UsageDto = z.infer<typeof UsageSchema>;
