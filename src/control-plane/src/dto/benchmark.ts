import { z } from 'zod';
import { IdSchema } from './common';

/** `pending` waits for the gateway holding the node, `running` is generating, then `done` or `failed`. */
export const BenchmarkResultStatusSchema = z.enum(['pending', 'running', 'done', 'failed']);

export const BenchmarkResultSchema = z.object({
  nodeId: IdSchema,
  nodeName: z.string().nullable(),
  status: BenchmarkResultStatusSchema,
  error: z.string().nullable(),
  /** Time to first token (includes prompt processing), in ms. */
  ttftMs: z.number().int().nullable(),
  totalMs: z.number().int().nullable(),
  /** Pieces generated. */
  tokens: z.number().int().nullable(),
  /** Generation speed after the first token. */
  tokensPerSec: z.number().nullable(),
});

export const BenchmarkSchema = z.object({
  id: IdSchema,
  orgId: IdSchema,
  poolId: IdSchema,
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
  /** Derived: running while any node is pending/running, done when none is. */
  status: z.enum(['running', 'done']),
  results: z.array(BenchmarkResultSchema),
});
export type BenchmarkDto = z.infer<typeof BenchmarkSchema>;

export const BenchmarkParamsSchema = z.object({
  orgId: IdSchema,
  poolId: IdSchema,
  benchmarkId: IdSchema,
});
