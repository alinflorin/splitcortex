import { z } from 'zod';
import { IdSchema, NameSchema } from './common';
import { LimitsSchema, UpdateLimitsSchema } from './limits';

export const ApiKeySchema = z.object({
  id: IdSchema,
  orgId: IdSchema,
  name: z.string(),
  /** Readable start of the token, for recognising a key in a list. */
  prefix: z.string(),
  /** True: every pool of the organisation (including future ones). Otherwise `poolIds` lists the allowed pools. */
  allPools: z.boolean(),
  poolIds: z.array(IdSchema),
  expiresAt: z.iso.datetime().nullable(),
  createdBy: z.string(),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  limits: LimitsSchema,
  createdAt: z.iso.datetime(),
});
export type ApiKeyDto = z.infer<typeof ApiKeySchema>;

export const CreateApiKeySchema = z
  .object({
    name: NameSchema,
    scope: z.enum(['org', 'pools']),
    poolIds: z.array(IdSchema).max(100).default([]),
    expiresAt: z.iso.datetime().optional(),
    limits: UpdateLimitsSchema.optional(),
  })
  .refine((v) => v.scope === 'org' || v.poolIds.length > 0, {
    message: 'validation.required',
    path: ['poolIds'],
  });
export type CreateApiKeyDto = z.input<typeof CreateApiKeySchema>;

/** The secret is returned exactly once, here. */
export const CreatedApiKeySchema = z.object({ key: ApiKeySchema, secret: z.string() });
export type CreatedApiKeyDto = z.infer<typeof CreatedApiKeySchema>;

export const ApiKeyParamsSchema = z.object({ orgId: IdSchema, keyId: IdSchema });

/** Change limits and/or the expiry (a new time, or null for never); at least one is required. */
export const UpdateApiKeySchema = z
  .object({
    limits: UpdateLimitsSchema.optional(),
    expiresAt: z.iso.datetime().nullable().optional(),
  })
  .refine((v) => v.limits !== undefined || v.expiresAt !== undefined, 'validation.required');
export type UpdateApiKeyDto = z.infer<typeof UpdateApiKeySchema>;
