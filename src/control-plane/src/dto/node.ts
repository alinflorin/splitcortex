import { z } from 'zod';
import { IdSchema, NameSchema } from './common';

/** `pending` = waiting for admin approval, `online` = connected to the gateway and reporting, `offline` otherwise. */
export const NodeStatusSchema = z.enum(['pending', 'online', 'offline']);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const ComputeBackendSchema = z.enum(['cpu', 'gpu']);
export type ComputeBackend = z.infer<typeof ComputeBackendSchema>;
/** Bounds of the context window an admin may force (tokens). */
export const MAX_CONTEXT_MIN = 512;
export const MAX_CONTEXT_MAX = 131072;

/** Live telemetry reported by the node through the gateway. All values are best effort. */
export const NodeLiveSchema = z.object({
  connectedSince: z.iso.datetime().nullable(),
  /** When the gateway last wrote this row. */
  updatedAt: z.iso.datetime(),
  cpuPercent: z.number().nullable(),
  memoryUsedMb: z.number().int().nullable(),
  batteryPercent: z.number().int().nullable(),
  charging: z.boolean().nullable(),
  temperatureC: z.number().nullable(),
  inFlight: z.number().int(),
  tokensPerSec: z.number().nullable(),
  /** What the engine actually runs on and its context window (the device's choice, or the override below). */
  backend: ComputeBackendSchema.nullable(),
  maxContextTokens: z.number().int().nullable(),
  /** Inputs the loaded model accepts besides text (empty = text only). */
  modalities: z.array(z.enum(['image', 'audio'])),
});
export type NodeLiveDto = z.infer<typeof NodeLiveSchema>;

export const NodeSchema = z.object({
  id: IdSchema,
  orgId: IdSchema,
  poolId: IdSchema,
  name: z.string(),
  fingerprint: z.string(),
  approved: z.boolean(),
  status: NodeStatusSchema,
  platform: z.string().nullable(),
  deviceModel: z.string().nullable(),
  osVersion: z.string().nullable(),
  appVersion: z.string().nullable(),
  cpuCores: z.number().int().nullable(),
  memoryTotalMb: z.number().int().nullable(),
  /** Admin overrides; null = the device decides (its own setting, else it measures and picks the fastest). */
  computeBackend: ComputeBackendSchema.nullable(),
  maxContextTokens: z.number().int().nullable(),
  /** Admin override of "keep the screen on"; null = the device decides. */
  keepScreenOn: z.boolean().nullable(),
  /** Admin override of multi-token prediction (speculative decoding); null = the device decides. */
  enableMtp: z.boolean().nullable(),
  createdAt: z.iso.datetime(),
  live: NodeLiveSchema.nullable(),
});
export type NodeDto = z.infer<typeof NodeSchema>;

export const NodeParamsSchema = z.object({ orgId: IdSchema, nodeId: IdSchema });
export const PoolNodesParamsSchema = z.object({ orgId: IdSchema, poolId: IdSchema });

export const UpdateNodeSchema = z
  .object({
    name: NameSchema.optional(),
    approved: z.literal(true).optional(),
    /** null clears the override. */
    computeBackend: ComputeBackendSchema.nullable().optional(),
    maxContextTokens: z
      .number()
      .int()
      .min(MAX_CONTEXT_MIN)
      .max(MAX_CONTEXT_MAX)
      .nullable()
      .optional(),
    keepScreenOn: z.boolean().nullable().optional(),
    enableMtp: z.boolean().nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'validation.required');
export type UpdateNodeDto = z.infer<typeof UpdateNodeSchema>;
