import { lt } from 'drizzle-orm';
import type { Db } from './client';
import { nodeMetrics, poolMetrics } from './schema';

/** Deletes metrics rows older than `retentionDays` (both tables). Returns how many went. */
export async function pruneMetrics(opts: {
  db: Db;
  retentionDays: number;
  now?: Date;
}): Promise<number> {
  const cutoff = new Date((opts.now ?? new Date()).getTime() - opts.retentionDays * 86_400_000);
  const pools = await opts.db
    .delete(poolMetrics)
    .where(lt(poolMetrics.bucket, cutoff))
    .returning({ orgId: poolMetrics.orgId });
  const nodes = await opts.db
    .delete(nodeMetrics)
    .where(lt(nodeMetrics.bucket, cutoff))
    .returning({ orgId: nodeMetrics.orgId });
  return pools.length + nodes.length;
}
