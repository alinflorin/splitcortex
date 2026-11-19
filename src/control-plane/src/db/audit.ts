import type { Db, Tx } from './client';
import { auditLogs } from './schema';

export interface AuditEvent {
  orgId: string;
  source?: 'control_plane' | 'gateway';
  actorType: 'user' | 'api_key' | 'node' | 'system';
  actorId?: string | null;
  /** Dotted verb, e.g. `pool.create`. */
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  outcome?: 'success' | 'denied' | 'failed';
  ip?: string | null;
  /** Small, non-secret facts. Never prompts, completions or key material. */
  metadata?: Record<string, unknown> | null;
}

/** Appends one audit row. Pass the transaction of the change when there is one, so both commit together. */
export async function recordAudit(db: Db | Tx, e: AuditEvent): Promise<void> {
  await db.insert(auditLogs).values({
    orgId: e.orgId,
    source: e.source ?? 'control_plane',
    actorType: e.actorType,
    actorId: e.actorId ?? null,
    action: e.action,
    entityType: e.entityType ?? null,
    entityId: e.entityId ?? null,
    outcome: e.outcome ?? 'success',
    ip: e.ip ?? null,
    metadata: e.metadata ?? null,
  });
}
