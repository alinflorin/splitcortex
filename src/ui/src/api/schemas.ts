// Copies of the control plane DTOs the web app needs (there is no shared package; keep in sync by hand with
// src/control-plane/src/dto). Validation messages are i18n keys, translated where they are rendered.
import { z } from 'zod';

const nameSchema = z
  .string()
  .trim()
  .min(1, { error: 'validation.required' })
  .max(100, { error: 'validation.tooLong' });

export const orgRoleSchema = z.enum(['owner', 'admin', 'member']);
export type OrgRole = z.infer<typeof orgRoleSchema>;

export const organisationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
  role: orgRoleSchema,
});
export type Organisation = z.infer<typeof organisationSchema>;

export const memberSchema = z.object({
  email: z.string(),
  role: orgRoleSchema,
  createdAt: z.string(),
});
export type Member = z.infer<typeof memberSchema>;

export const poolSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  requireApproval: z.boolean(),
  createdAt: z.string(),
});
export type Pool = z.infer<typeof poolSchema>;

const countersShape = {
  tokensIn: z.number(),
  tokensOut: z.number(),
  requests: z.number(),
  errors: z.number(),
};
export const usageSchema = z.object({
  from: z.string(),
  to: z.string(),
  granularity: z.enum(['hour', 'day']),
  totals: z.object(countersShape),
  series: z.array(z.object({ bucket: z.string(), group: z.string().nullable(), ...countersShape })),
});
export type Usage = z.infer<typeof usageSchema>;

// Form schemas (request bodies).
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, { error: 'validation.required' })
  .max(40, { error: 'validation.tooLong' })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: 'validation.slug' });

export const organisationFormSchema = z.object({ name: nameSchema, slug: slugSchema });
export type OrganisationForm = z.infer<typeof organisationFormSchema>;

export const poolFormSchema = z.object({ name: nameSchema, requireApproval: z.boolean() });
export type PoolForm = z.infer<typeof poolFormSchema>;

export const addMemberFormSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, { error: 'validation.required' })
    .pipe(z.email({ error: 'validation.email' })),
  role: orgRoleSchema,
});
export type AddMemberForm = z.infer<typeof addMemberFormSchema>;
