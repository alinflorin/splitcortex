import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().default(8080),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  /** Dex issuer URL (the `iss` claim of the web app's tokens). */
  OIDC_ISSUER: z.url(),
  /** Expected `aud`: the Dex client id of the web app. */
  OIDC_AUDIENCE: z.string().default('splitcortex-ui'),
  /** Where to fetch signing keys. Defaults to `<issuer>/keys`; set to the in-cluster Dex service when the public issuer is not reachable or trusted from the pod. */
  OIDC_JWKS_URL: z.url().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse({ ...env, OIDC_JWKS_URL: env.OIDC_JWKS_URL || undefined });
}
