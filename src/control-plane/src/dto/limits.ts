import { z } from 'zod';

const limit = (max: number) => z.number().int().min(1, 'validation.min').max(max, 'validation.max');

/**
 * Rate limits the gateway enforces. `null` = unlimited. An organisation has its own limits and every API key can have
 * more (the stricter of the two applies). Per-minute limits are per gateway instance (approximate with several);
 * tokens per day count prompt + completion tokens of the UTC day.
 */
export const LimitsSchema = z.object({
  requestsPerMinute: limit(10_000_000).nullable(),
  tokensPerMinute: limit(1_000_000_000).nullable(),
  tokensPerDay: limit(1_000_000_000_000).nullable(),
});
export type LimitsDto = z.infer<typeof LimitsSchema>;

/** Fields left out are kept; `null` clears a limit. */
export const UpdateLimitsSchema = LimitsSchema.partial().refine(
  (v) => Object.values(v).some((x) => x !== undefined),
  'validation.required',
);
export type UpdateLimitsDto = z.infer<typeof UpdateLimitsSchema>;

export const NO_LIMITS: LimitsDto = {
  requestsPerMinute: null,
  tokensPerMinute: null,
  tokensPerDay: null,
};
