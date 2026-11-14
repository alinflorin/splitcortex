import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { buildApp } from '../app';
import type { Db } from '../db/client';
import * as schema from '../db/schema';

/** In-process Postgres (PGlite) with the real migrations applied, plus an app that trusts tokens `email:<address>`. */
export async function createTestApp() {
  const client = new PGlite();
  const pg = drizzle(client, { schema });
  await migrate(pg, { migrationsFolder: './drizzle' });
  // Same query API as the node-postgres Db the app is written against.
  const db = pg as unknown as Db;
  const app = await buildApp({
    db,
    logLevel: 'silent',
    verify: async (token) => {
      const email = token.startsWith('email:') ? token.slice(6) : undefined;
      if (!email) throw new Error('bad token');
      return { sub: email, email };
    },
  });
  const as = (email: string) => ({ authorization: `Bearer email:${email}` });
  return { app, db, as, close: () => client.close() };
}
