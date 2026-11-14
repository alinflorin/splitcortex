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

const SlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'validation.required')
  .max(40, 'validation.tooLong')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'validation.slug');

export const CreateOrganisationSchema = z.object({ name: NameSchema, slug: SlugSchema });
export type CreateOrganisationDto = z.infer<typeof CreateOrganisationSchema>;

export const UpdateOrganisationSchema = z
  .object({ name: NameSchema, slug: SlugSchema })
  .partial()
  .refine((v) => v.name !== undefined || v.slug !== undefined, 'validation.required');
export type UpdateOrganisationDto = z.infer<typeof UpdateOrganisationSchema>;

export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email('validation.email'));

export const MemberSchema = z.object({
  email: z.string(),
  role: OrgRoleSchema,
  createdAt: z.iso.datetime(),
});
export type MemberDto = z.infer<typeof MemberSchema>;

export const AddMemberSchema = z.object({
  email: EmailSchema,
  role: OrgRoleSchema.default('member'),
});
export type AddMemberDto = z.input<typeof AddMemberSchema>;

export const UpdateMemberSchema = z.object({ role: OrgRoleSchema });
export type UpdateMemberDto = z.infer<typeof UpdateMemberSchema>;

export const MemberParamsSchema = z.object({ orgId: IdSchema, email: EmailSchema });
