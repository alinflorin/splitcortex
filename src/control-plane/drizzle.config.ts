import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` diffs src/db/schema.ts against ./drizzle and writes a new SQL migration (no DB needed).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
