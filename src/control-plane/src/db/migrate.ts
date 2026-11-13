import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

// Run by the Helm migration Job (and `pnpm db:migrate`). Retries while Postgres is still starting.
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const folder = process.env.MIGRATIONS_DIR ?? './drizzle';

const { db, pool } = createDb(url);
// Only connection-level failures are retried; a bad migration fails fast with the underlying database error.
const transient = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ECONNRESET',
  'EAI_AGAIN',
  '57P03',
  '08006',
  '08001',
]);
const rootCause = (err: unknown): { code?: string; message: string } => {
  let e = err as { code?: string; message: string; cause?: unknown };
  while (e.cause) e = e.cause as typeof e;
  return e;
};

for (let attempt = 1; ; attempt++) {
  try {
    await migrate(db, { migrationsFolder: folder });
    break;
  } catch (err) {
    const cause = rootCause(err);
    if (!cause.code || !transient.has(cause.code) || attempt >= 30) {
      console.error('migration failed:', cause.message);
      await pool.end();
      process.exit(1);
    }
    console.error(`database not ready (${cause.code}), attempt ${attempt}, retrying in 2s`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
await pool.end();
console.log('migrations applied');
