import { lt } from 'drizzle-orm';
import type { Db } from './client';
import { auditLogs } from './schema';

/** Deletes audit rows older than `retentionDays`. Returns how many went. */
export async function pruneAuditLogs(opts: {
  db: Db;
  retentionDays: number;
  now?: Date;
}): Promise<number> {
  const cutoff = new Date((opts.now ?? new Date()).getTime() - opts.retentionDays * 86_400_000);
  const deleted = await opts.db
    .delete(auditLogs)
    .where(lt(auditLogs.occurredAt, cutoff))
    .returning({ id: auditLogs.id });
  return deleted.length;
}
