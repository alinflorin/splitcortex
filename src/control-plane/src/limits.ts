import type { LimitsDto, UpdateLimitsDto } from './dto';

interface LimitColumns {
  limitRequestsPerMinute: number | null;
  limitTokensPerMinute: number | null;
  limitTokensPerDay: number | null;
}

export const limitsOf = (row: LimitColumns): LimitsDto => ({
  requestsPerMinute: row.limitRequestsPerMinute,
  tokensPerMinute: row.limitTokensPerMinute,
  tokensPerDay: row.limitTokensPerDay,
});

/** Column values for the fields present in `update` (absent = untouched, null = cleared). */
export const limitColumns = (update: UpdateLimitsDto): Partial<LimitColumns> => ({
  ...(update.requestsPerMinute !== undefined && {
    limitRequestsPerMinute: update.requestsPerMinute,
  }),
  ...(update.tokensPerMinute !== undefined && { limitTokensPerMinute: update.tokensPerMinute }),
  ...(update.tokensPerDay !== undefined && { limitTokensPerDay: update.tokensPerDay }),
});
