import { z } from 'zod';

export const IdSchema = z.uuid();

export const ErrorSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
});
export type ErrorDto = z.infer<typeof ErrorSchema>;

export const OrgIdParamsSchema = z.object({ orgId: IdSchema });
export type OrgIdParams = z.infer<typeof OrgIdParamsSchema>;

/** A trimmed, non-empty display name. */
export const NameSchema = z
  .string()
  .trim()
  .min(1, 'validation.required')
  .max(100, 'validation.tooLong');
