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
  /**
   * Object storage for model files (S3 API; Garage in the chart). Optional: without it the models API answers 503.
   * `S3_ENDPOINT` is the in-cluster service; storage is never exposed to browsers (uploads pass through the API).
   */
  S3_ENDPOINT: z.url().optional(),
  S3_BUCKET: z.string().default('models'),
  S3_REGION: z.string().default('garage'),
  /** Garage admin API (in-cluster only): when set, the control plane bootstraps the layout, key and bucket at start. */
  GARAGE_ADMIN_URL: z.url().optional(),
  GARAGE_ADMIN_TOKEN: z.string().optional(),
  GARAGE_ZONE: z.string().default('dc1'),
  GARAGE_CAPACITY_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(20 * 1024 ** 3),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Optional Hugging Face token for gated models; only ever sent to huggingface.co, never to devices. */
  HF_TOKEN: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const blank = (v: string | undefined) => v || undefined;
  return ConfigSchema.parse({
    ...env,
    OIDC_JWKS_URL: blank(env.OIDC_JWKS_URL),
    S3_ENDPOINT: blank(env.S3_ENDPOINT),
    GARAGE_ADMIN_URL: blank(env.GARAGE_ADMIN_URL),
    GARAGE_ADMIN_TOKEN: blank(env.GARAGE_ADMIN_TOKEN),
    S3_ACCESS_KEY_ID: blank(env.S3_ACCESS_KEY_ID),
    S3_SECRET_ACCESS_KEY: blank(env.S3_SECRET_ACCESS_KEY),
    HF_TOKEN: blank(env.HF_TOKEN),
  });
}
