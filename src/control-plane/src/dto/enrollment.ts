import { z } from 'zod';
import { IdSchema } from './common';

/** Base64url without padding, as used on the device protocol. */
export const B64Schema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'validation.invalid')
  .max(4096);

export const EnrollmentSchema = z.object({
  id: IdSchema,
  poolId: IdSchema,
  createdBy: z.string(),
  expiresAt: z.iso.datetime(),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type EnrollmentDto = z.infer<typeof EnrollmentSchema>;

/** The code is only ever returned by the create call (it is the credential). */
export const CreatedEnrollmentSchema = z.object({
  enrollment: EnrollmentSchema,
  /** `XXXX-XXXXXX`, Crockford base32. */
  code: z.string(),
});
export type CreatedEnrollmentDto = z.infer<typeof CreatedEnrollmentSchema>;

export const EnrollmentParamsSchema = z.object({ orgId: IdSchema, enrollmentId: IdSchema });

// --- Device protocol (unauthenticated; the PAKE authenticates both sides) ---

export const EnrollStartSchema = z.object({
  /** First 4 characters of the code (public lookup id). */
  lookupId: z
    .string()
    .length(4)
    .regex(/^[0-9A-Z]+$/),
  /** CPace session id, 16 random bytes chosen by the device (the generator depends on it). */
  sid: B64Schema,
  /** CPace share of the device. */
  share: B64Schema,
});
export const EnrollStartResponseSchema = z.object({ share: B64Schema });

export const EnrollCompleteSchema = z.object({
  lookupId: z
    .string()
    .length(4)
    .regex(/^[0-9A-Z]+$/),
  /** `EnrollRequestPlain` sealed with the PAKE key. */
  sealed: B64Schema,
});
export const EnrollCompleteResponseSchema = z.object({ sealed: B64Schema });

/** Plaintext inside the sealed request. */
export const EnrollRequestPlainSchema = z.object({
  /** Ed25519 public key, 32 raw bytes, base64url. */
  publicKey: B64Schema,
  /** Ed25519 signature over `"splitcortex-enroll-v1" || sid`: proof the device holds the private key. */
  signature: B64Schema,
  name: z.string().trim().min(1).max(100).optional(),
  platform: z.string().max(50).optional(),
  deviceModel: z.string().max(100).optional(),
  osVersion: z.string().max(50).optional(),
  appVersion: z.string().max(50).optional(),
  cpuCores: z.number().int().min(1).max(1024).optional(),
  memoryTotalMb: z.number().int().min(1).max(10_000_000).optional(),
});
export type EnrollRequestPlain = z.infer<typeof EnrollRequestPlainSchema>;

/** Plaintext inside the sealed response. */
export const EnrollResponsePlainSchema = z.object({
  nodeId: IdSchema,
  fingerprint: z.string(),
  /** False while the pool requires admin approval. */
  approved: z.boolean(),
  /** The gateway's pinned identity; null when the control plane has none configured yet. */
  gateway: z.object({ publicKey: z.string(), url: z.string() }).nullable(),
});
export type EnrollResponsePlain = z.infer<typeof EnrollResponsePlainSchema>;
