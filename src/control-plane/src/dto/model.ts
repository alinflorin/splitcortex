import { z } from 'zod';
import { IdSchema, NameSchema } from './common';

export const ModelSourceSchema = z.enum(['huggingface', 'upload']);
export const ModelStatusSchema = z.enum(['pending', 'downloading', 'uploading', 'ready', 'failed']);
export type ModelStatus = z.infer<typeof ModelStatusSchema>;

/** LiteRT-LM is the only supported engine. */
export const MODEL_EXTENSIONS = ['.litertlm'] as const;
/** Upper bound for one model file (the multipart limit is far higher; this just stops mistakes and abuse). */
export const MAX_MODEL_BYTES = 32 * 1024 ** 3;

export const ModelSchema = z.object({
  id: IdSchema,
  orgId: IdSchema,
  name: z.string(),
  source: ModelSourceSchema,
  sourceUrl: z.string().nullable(),
  fileName: z.string(),
  status: ModelStatusSchema,
  error: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  progressBytes: z.number().int(),
  sha256: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ModelDto = z.infer<typeof ModelSchema>;

const hasModelExtension = (name: string) =>
  MODEL_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

export const CreateModelFromUrlSchema = z.object({
  name: NameSchema,
  url: z
    .url({ protocol: /^https$/, hostname: /^(?:[a-z0-9-]+\.)*huggingface\.co$/ })
    .refine((u) => hasModelExtension(new URL(u).pathname), 'validation.modelFile'),
});
export type CreateModelFromUrlDto = z.infer<typeof CreateModelFromUrlSchema>;

export const CreateModelUploadSchema = z.object({
  name: NameSchema,
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[^/\\]+$/, 'validation.modelFile')
    .refine(hasModelExtension, 'validation.modelFile'),
  sizeBytes: z.number().int().positive().max(MAX_MODEL_BYTES),
});
export type CreateModelUploadDto = z.infer<typeof CreateModelUploadSchema>;

/** What the browser needs to upload the file part by part through the control plane (`PUT .../parts/:partNumber`). */
export const ModelUploadSchema = z.object({
  model: ModelSchema,
  partSize: z.number().int(),
  partCount: z.number().int(),
});
export const ModelPartSchema = z.object({ etag: z.string() });
export const ModelPartParamsSchema = z.object({
  orgId: IdSchema,
  modelId: IdSchema,
  partNumber: z.coerce.number().int().min(1).max(10000),
});
export type ModelUploadDto = z.infer<typeof ModelUploadSchema>;

export const CompleteModelUploadSchema = z.object({
  parts: z.array(z.object({ partNumber: z.number().int().min(1), etag: z.string().min(1) })).min(1),
});
export type CompleteModelUploadDto = z.infer<typeof CompleteModelUploadSchema>;

export const ModelParamsSchema = z.object({ orgId: IdSchema, modelId: IdSchema });
export const PoolModelParamsSchema = z.object({
  orgId: IdSchema,
  poolId: IdSchema,
  modelId: IdSchema,
});
