import { loadConfig } from '../config';
import { createDb } from './client';
import { pruneAuditLogs } from './audit-prune';

// Run by the `control-plane-audit-prune` CronJob: drops audit rows past the retention window.
const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
try {
  const removed = await pruneAuditLogs({
    db,
    retentionDays: Number(process.env.AUDIT_RETENTION_DAYS ?? 90),
  });
  console.log(`audit prune done: ${removed} rows removed`);
} catch (err) {
  console.error('audit prune failed:', String(err));
  process.exitCode = 1;
} finally {
  await pool.end();
}
