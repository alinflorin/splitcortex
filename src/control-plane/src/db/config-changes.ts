import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client';
import { configChanges } from './schema';

export interface ConfigChange {
  entityType: 'organisation' | 'pool' | 'node' | 'api_key';
  entityId: string;
  orgId: string;
}

/** Records a change in the feed. Call inside the transaction that makes the change; returns the new seq. */
export async function recordConfigChange(tx: Tx, change: ConfigChange): Promise<number> {
  const [row] = await tx.insert(configChanges).values(change).returning({ seq: configChanges.seq });
  return row!.seq;
}

/** Wake-up for the gateway. Call after the transaction committed; notifications may be lost (it has a backstop poll). */
export async function notifyConfigChange(db: Db, seq: number): Promise<void> {
  await db.execute(sql`select pg_notify('config_changes', ${String(seq)})`);
}
