import { z } from 'zod';
import { IdSchema, NameSchema } from './common';

export const OrgRoleSchema = z.enum(['owner', 'admin', 'member']);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

export const OrganisationSchema = z.object({
  id: IdSchema,
  name: z.string(),
  slug: z.string(),
  createdAt: z.iso.datetime(),
});
export type OrganisationDto = z.infer<typeof OrganisationSchema>;

/** An organisation as seen by one of its members. */
export const OrganisationWithRoleSchema = OrganisationSchema.extend({ role: OrgRoleSchema });
export type OrganisationWithRoleDto = z.infer<typeof OrganisationWithRoleSchema>;

export const CreateOrganisationSchema = z.object({
  name: NameSchema,
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'validation.required')
    .max(40, 'validation.tooLong')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'validation.slug'),
});
export type CreateOrganisationDto = z.infer<typeof CreateOrganisationSchema>;
