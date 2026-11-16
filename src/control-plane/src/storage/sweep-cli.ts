import { loadConfig } from '../config';
import { createDb } from '../db/client';
import { createS3Storage, s3SettingsFromConfig } from './s3';
import { sweepAbandonedUploads } from './sweep';

// Run by the `control-plane-sweep` CronJob: aborts abandoned multipart uploads (see sweep.ts).
const config = loadConfig();
const s3 = s3SettingsFromConfig(config);
if (!s3) {
  console.error('S3 storage is not configured, nothing to sweep');
  process.exit(1);
}
const { db, pool } = createDb(config.DATABASE_URL);
try {
  const result = await sweepAbandonedUploads({
    db,
    storage: createS3Storage(s3),
    maxAgeMs: Number(process.env.SWEEP_MAX_AGE_HOURS ?? 24) * 3_600_000,
    log: (m) => console.log(m),
  });
  console.log(`sweep done: ${JSON.stringify(result)}`);
} catch (err) {
  console.error('sweep failed:', String(err));
  process.exitCode = 1;
} finally {
  await pool.end();
}
