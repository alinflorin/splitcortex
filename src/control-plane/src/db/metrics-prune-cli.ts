import { loadConfig } from '../config';
import { createDb } from './client';
import { pruneMetrics } from './metrics-prune';

// Run by the `control-plane-metrics-prune` CronJob: drops metrics rows past the retention window (default 7 days).
const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
try {
  const removed = await pruneMetrics({
    db,
    retentionDays: Number(process.env.METRICS_RETENTION_DAYS ?? 7),
  });
  console.log(`metrics prune done: ${removed} rows removed`);
} catch (err) {
  console.error('metrics prune failed:', String(err));
  process.exitCode = 1;
} finally {
  await pool.end();
}
