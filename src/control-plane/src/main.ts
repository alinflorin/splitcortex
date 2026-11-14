import { buildApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { startMirrorWorker } from './models/mirror';
import { createDexVerifier } from './plugins/auth';
import { createS3Storage, s3SettingsFromConfig } from './storage/s3';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const s3 = s3SettingsFromConfig(config);
const storage = s3 ? createS3Storage(s3) : null;
const app = await buildApp({
  db,
  storage,
  verify: createDexVerifier(config),
  oidc: { issuer: config.OIDC_ISSUER, clientId: config.OIDC_AUDIENCE },
  logLevel: config.LOG_LEVEL,
});

let stopMirror: (() => Promise<void>) | undefined;
if (storage) {
  stopMirror = startMirrorWorker({ db, storage, hfToken: config.HF_TOKEN, log: app.log });
} else {
  app.log.warn('S3 storage is not configured: the models API is disabled');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (stopMirror?.() ?? Promise.resolve())
      .then(() => app.close())
      .then(() => pool.end())
      .finally(() => process.exit(0));
  });
}

await app.listen({ host: '0.0.0.0', port: config.PORT });
