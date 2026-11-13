import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { createDexVerifier } from './plugins/auth';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const app = await buildApp({
  db,
  verify: createDexVerifier(config),
  oidc: { issuer: config.OIDC_ISSUER, clientId: config.OIDC_AUDIENCE },
  logLevel: config.LOG_LEVEL,
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app
      .close()
      .then(() => pool.end())
      .finally(() => process.exit(0));
  });
}

await app.listen({ host: '0.0.0.0', port: config.PORT });
