import type { Limits } from '../api/schemas';

/** What the three limit inputs hold (empty = unlimited). */
export interface LimitsText {
  requestsPerMinute: string;
  tokensPerMinute: string;
  tokensPerDay: string;
}

/** Bounds the control plane enforces. */
export const LIMIT_MAX: Record<keyof Limits, number> = {
  requestsPerMinute: 10_000_000,
  tokensPerMinute: 1_000_000_000,
  tokensPerDay: 1_000_000_000_000,
};

export const EMPTY_LIMITS_TEXT: LimitsText = {
  requestsPerMinute: '',
  tokensPerMinute: '',
  tokensPerDay: '',
};

export const limitsToText = (l: Limits): LimitsText => ({
  requestsPerMinute: l.requestsPerMinute?.toString() ?? '',
  tokensPerMinute: l.tokensPerMinute?.toString() ?? '',
  tokensPerDay: l.tokensPerDay?.toString() ?? '',
});

/** Empty = no limit (null), a whole number within the bound, else undefined (invalid). */
export function parseLimit(text: string, max: number): number | null | undefined {
  const v = text.trim();
  if (v === '') return null;
  if (!/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  return n >= 1 && n <= max ? n : undefined;
}

/** The fields that are invalid. */
export function invalidLimits(text: LimitsText): (keyof Limits)[] {
  return (Object.keys(LIMIT_MAX) as (keyof Limits)[]).filter(
    (k) => parseLimit(text[k], LIMIT_MAX[k]) === undefined,
  );
}

/** All three parsed, or undefined when any is invalid. */
export function textToLimits(text: LimitsText): Limits | undefined {
  if (invalidLimits(text).length > 0) return undefined;
  return {
    requestsPerMinute: parseLimit(text.requestsPerMinute, LIMIT_MAX.requestsPerMinute) ?? null,
    tokensPerMinute: parseLimit(text.tokensPerMinute, LIMIT_MAX.tokensPerMinute) ?? null,
    tokensPerDay: parseLimit(text.tokensPerDay, LIMIT_MAX.tokensPerDay) ?? null,
  };
}
