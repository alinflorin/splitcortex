import { z } from 'zod';

export const AuditOutcomeSchema = z.enum(['success', 'denied', 'failed']);

export const AuditQuerySchema = z.object({
  /** Exact action (`pool.create`) or a prefix ending in a dot (`pool.`). */
  action: z.string().min(1).max(100).optional(),
  actor: z.string().min(1).max(320).optional(),
  outcome: AuditOutcomeSchema.optional(),
  source: z.enum(['control_plane', 'gateway']).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Opaque, from the previous page's `nextCursor`. */
  cursor: z.string().min(1).max(200).optional(),
});
export type AuditQuery = z.input<typeof AuditQuerySchema>;

/** Same filters as the list, no paging; `format` picks the file type. */
export const AuditExportQuerySchema = AuditQuerySchema.omit({ limit: true, cursor: true }).extend({
  format: z.enum(['csv', 'json']).default('csv'),
});

export const AuditEntrySchema = z.object({
  id: z.uuid(),
  occurredAt: z.iso.datetime(),
  source: z.enum(['control_plane', 'gateway']),
  actorType: z.enum(['user', 'api_key', 'node', 'system']),
  actorId: z.string().nullable(),
  action: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  outcome: AuditOutcomeSchema,
  ip: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type AuditEntryDto = z.infer<typeof AuditEntrySchema>;

export const AuditPageSchema = z.object({
  items: z.array(AuditEntrySchema),
  nextCursor: z.string().nullable(),
});
export type AuditPageDto = z.infer<typeof AuditPageSchema>;
