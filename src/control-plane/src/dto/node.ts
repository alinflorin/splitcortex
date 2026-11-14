import { z } from 'zod';
import { IdSchema, NameSchema } from './common';

/** `pending` = waiting for admin approval, `online` = connected to the gateway and reporting, `offline` otherwise. */
export const NodeStatusSchema = z.enum(['pending', 'online', 'offline']);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

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
  createdAt: z.iso.datetime(),
  live: NodeLiveSchema.nullable(),
});
export type NodeDto = z.infer<typeof NodeSchema>;

export const NodeParamsSchema = z.object({ orgId: IdSchema, nodeId: IdSchema });
export const PoolNodesParamsSchema = z.object({ orgId: IdSchema, poolId: IdSchema });

export const UpdateNodeSchema = z
  .object({ name: NameSchema.optional(), approved: z.literal(true).optional() })
  .refine((v) => v.name !== undefined || v.approved !== undefined, 'validation.required');
export type UpdateNodeDto = z.infer<typeof UpdateNodeSchema>;
