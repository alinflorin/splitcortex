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

export const servingTypeSchema = z.enum(['replicated']);
export const balancingTypeSchema = z.enum([
  'weighted_p2c',
  'least_in_flight',
  'round_robin',
  'random',
]);
export type BalancingType = z.infer<typeof balancingTypeSchema>;
export const BALANCING_TYPES = balancingTypeSchema.options;

export const poolSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  requireApproval: z.boolean(),
  servingType: servingTypeSchema,
  balancingType: balancingTypeSchema,
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

export const poolFormSchema = z.object({
  name: nameSchema,
  requireApproval: z.boolean(),
  servingType: servingTypeSchema,
  balancingType: balancingTypeSchema,
});
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

export const nodeStatusSchema = z.enum(['pending', 'online', 'offline']);
export type NodeStatus = z.infer<typeof nodeStatusSchema>;

export const nodeSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  poolId: z.string(),
  name: z.string(),
  fingerprint: z.string(),
  approved: z.boolean(),
  status: nodeStatusSchema,
  platform: z.string().nullable(),
  deviceModel: z.string().nullable(),
  osVersion: z.string().nullable(),
  appVersion: z.string().nullable(),
  cpuCores: z.number().nullable(),
  memoryTotalMb: z.number().nullable(),
  createdAt: z.string(),
  live: z
    .object({
      connectedSince: z.string().nullable(),
      updatedAt: z.string(),
      cpuPercent: z.number().nullable(),
      memoryUsedMb: z.number().nullable(),
      batteryPercent: z.number().nullable(),
      charging: z.boolean().nullable(),
      temperatureC: z.number().nullable(),
      inFlight: z.number(),
      tokensPerSec: z.number().nullable(),
    })
    .nullable(),
});
export type Node = z.infer<typeof nodeSchema>;

export const modelStatusSchema = z.enum(['pending', 'downloading', 'uploading', 'ready', 'failed']);
export type ModelStatus = z.infer<typeof modelStatusSchema>;

export const modelSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  source: z.enum(['huggingface', 'upload']),
  sourceUrl: z.string().nullable(),
  fileName: z.string(),
  status: modelStatusSchema,
  error: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  progressBytes: z.number(),
  sha256: z.string().nullable(),
  createdAt: z.string(),
});
export type Model = z.infer<typeof modelSchema>;

export const modelUploadSchema = z.object({
  model: modelSchema,
  partSize: z.number(),
  partCount: z.number(),
});
export type ModelUpload = z.infer<typeof modelUploadSchema>;

/** LiteRT-LM is the only supported engine. */
export const MODEL_EXTENSION = '.litertlm';

const modelNameSchema = z
  .string()
  .trim()
  .min(1, { error: 'validation.required' })
  .max(100, { error: 'validation.tooLong' });

export const modelFromUrlFormSchema = z.object({
  name: modelNameSchema,
  url: z
    .string()
    .trim()
    .min(1, { error: 'validation.required' })
    .refine(
      (v) => {
        try {
          const u = new URL(v);
          return (
            u.protocol === 'https:' &&
            (u.hostname === 'huggingface.co' || u.hostname.endsWith('.huggingface.co')) &&
            u.pathname.toLowerCase().endsWith(MODEL_EXTENSION)
          );
        } catch {
          return false;
        }
      },
      { error: 'validation.hfUrl' },
    ),
});
export type ModelFromUrlForm = z.infer<typeof modelFromUrlFormSchema>;

export const modelUploadFormSchema = z.object({ name: modelNameSchema });
export type ModelUploadForm = z.infer<typeof modelUploadFormSchema>;
