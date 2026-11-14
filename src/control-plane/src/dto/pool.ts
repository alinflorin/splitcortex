import { z } from 'zod';
import { IdSchema, NameSchema } from './common';

/** `replicated`: every node of the pool holds the same models. (Sharding a model across nodes is future work.) */
export const ServingTypeSchema = z.enum(['replicated']);
export type ServingType = z.infer<typeof ServingTypeSchema>;

/**
 * How the gateway picks a node for a request:
 * - `weighted_p2c`: power of two choices on in-flight requests, weighted by measured tokens/sec (default)
 * - `least_in_flight`: the node with the fewest in-flight requests
 * - `round_robin`: nodes in turn
 * - `random`: uniformly at random
 */
export const BalancingTypeSchema = z.enum([
  'weighted_p2c',
  'least_in_flight',
  'round_robin',
  'random',
]);
export type BalancingType = z.infer<typeof BalancingTypeSchema>;

export const PoolSchema = z.object({
  id: IdSchema,
  orgId: IdSchema,
  name: z.string(),
  requireApproval: z.boolean(),
  servingType: ServingTypeSchema,
  balancingType: BalancingTypeSchema,
  createdAt: z.iso.datetime(),
});
export type PoolDto = z.infer<typeof PoolSchema>;

export const CreatePoolSchema = z.object({
  name: NameSchema,
  requireApproval: z.boolean().default(false),
  servingType: ServingTypeSchema.default('replicated'),
  balancingType: BalancingTypeSchema.default('weighted_p2c'),
});
export type CreatePoolDto = z.input<typeof CreatePoolSchema>;

export const PoolParamsSchema = z.object({ orgId: IdSchema, poolId: IdSchema });

// Explicit (not `CreatePoolSchema.partial()`): defaults must not leak into a PATCH and reset untouched fields.
export const UpdatePoolSchema = z
  .object({
    name: NameSchema.optional(),
    requireApproval: z.boolean().optional(),
    servingType: ServingTypeSchema.optional(),
    balancingType: BalancingTypeSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'validation.required');
export type UpdatePoolDto = z.infer<typeof UpdatePoolSchema>;
