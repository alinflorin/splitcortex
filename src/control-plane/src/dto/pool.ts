import { z } from 'zod';
import { IdSchema, NameSchema } from './common';

export const PoolSchema = z.object({
  id: IdSchema,
  orgId: IdSchema,
  name: z.string(),
  requireApproval: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type PoolDto = z.infer<typeof PoolSchema>;

export const CreatePoolSchema = z.object({
  name: NameSchema,
  requireApproval: z.boolean().default(false),
});
export type CreatePoolDto = z.input<typeof CreatePoolSchema>;
