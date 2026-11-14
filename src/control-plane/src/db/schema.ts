import {
  bigint,
  doublePrecision,
  integer,
  bigserial,
  boolean,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const orgRole = pgEnum('org_role', ['owner', 'admin', 'member']);
/** How a pool serves models. Only identical replication for now; sharding a model across nodes is future work. */
export const servingType = pgEnum('serving_type', ['replicated']);
export const balancingType = pgEnum('balancing_type', [
  'weighted_p2c',
  'least_in_flight',
  'round_robin',
  'random',
]);
export const modelSource = pgEnum('model_source', ['huggingface', 'upload']);
export const modelStatus = pgEnum('model_status', [
  'pending',
  'downloading',
  'uploading',
  'ready',
  'failed',
]);

export const organisations = pgTable('organisations', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    /** Lowercased email from the Dex token. There is no users table: Dex owns identities. */
    userEmail: text('user_email').notNull(),
    role: orgRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userEmail] })],
);

export const pools = pgTable(
  'pools',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    requireApproval: boolean('require_approval').notNull().default(false),
    servingType: servingType('serving_type').notNull().default('replicated'),
    balancingType: balancingType('balancing_type').notNull().default('weighted_p2c'),
    createdAt: createdAt(),
  },
  (t) => [unique('pools_org_id_name_unique').on(t.orgId, t.name)],
);

/**
 * A registered device. Created by enrollment (not built yet); `publicKey` is the device's own key (the gateway
 * authenticates by proof of possession), revoking a node means deleting this row.
 */
export const nodes = pgTable(
  'nodes',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    poolId: uuid('pool_id')
      .notNull()
      .references(() => pools.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    publicKey: text('public_key').notNull().unique(),
    /** Short fingerprint of the public key, shown to admins when approving. */
    fingerprint: text('fingerprint').notNull(),
    approved: boolean('approved').notNull().default(true),
    // Device info reported at enrollment.
    platform: text('platform'),
    deviceModel: text('device_model'),
    osVersion: text('os_version'),
    appVersion: text('app_version'),
    cpuCores: integer('cpu_cores'),
    memoryTotalMb: integer('memory_total_mb'),
    createdAt: createdAt(),
  },
  (t) => [index('nodes_pool_idx').on(t.poolId)],
);

/**
 * Live telemetry, written by the gateway only (it holds the node connections) and read by the control plane for
 * dashboards. A node counts as online only while `connected` is true AND the row was updated recently, so a crashed
 * gateway cannot leave nodes looking online forever.
 */
export const nodeStatus = pgTable('node_status', {
  nodeId: uuid('node_id')
    .primaryKey()
    .references(() => nodes.id, { onDelete: 'cascade' }),
  connected: boolean('connected').notNull().default(false),
  connectedSince: timestamp('connected_since', { withTimezone: true }),
  cpuPercent: doublePrecision('cpu_percent'),
  memoryUsedMb: integer('memory_used_mb'),
  batteryPercent: integer('battery_percent'),
  charging: boolean('charging'),
  temperatureC: doublePrecision('temperature_c'),
  inFlight: integer('in_flight').notNull().default(0),
  tokensPerSec: doublePrecision('tokens_per_sec'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A model file owned by an organisation, stored in object storage and replicated onto the nodes of the pools it is assigned to. */
export const models = pgTable(
  'models',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    source: modelSource('source').notNull(),
    /** Hugging Face URL (normalised to `/resolve/`) for `source = huggingface`. */
    sourceUrl: text('source_url'),
    fileName: text('file_name').notNull(),
    status: modelStatus('status').notNull(),
    error: text('error'),
    /** Object key in the models bucket. */
    storageKey: text('storage_key').notNull(),
    /** Open multipart upload (browser uploads only). */
    uploadId: text('upload_id'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    /** Bytes mirrored so far (Hugging Face downloads). */
    progressBytes: bigint('progress_bytes', { mode: 'number' }).notNull().default(0),
    sha256: text('sha256'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('models_org_id_name_unique').on(t.orgId, t.name),
    index('models_status_idx').on(t.status),
  ],
);

/** Which models a pool serves (every node of the pool gets all of them). */
export const poolModels = pgTable(
  'pool_models',
  {
    poolId: uuid('pool_id')
      .notNull()
      .references(() => pools.id, { onDelete: 'cascade' }),
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.poolId, t.modelId] })],
);

/**
 * An API key for the gateway. Only the SHA-256 of the secret is stored (`hash`); `prefix` is the readable start of the
 * token for display. Scope: `allPools` (every pool of the organisation, present and future) or the pools listed in
 * `api_key_pools`. Revoking is a soft delete so usage history keeps its `key_id`. `lastUsedAt` is written by the gateway.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    hash: text('hash').notNull().unique(),
    allPools: boolean('all_pools').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('api_keys_org_idx').on(t.orgId)],
);

/** Pools a non-org-wide key may use (rows disappear with the pool or the key). */
export const apiKeyPools = pgTable(
  'api_key_pools',
  {
    keyId: uuid('key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    poolId: uuid('pool_id')
      .notNull()
      .references(() => pools.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.keyId, t.poolId] }),
    index('api_key_pools_pool_idx').on(t.poolId),
  ],
);

/**
 * Change feed for the gateway's in-memory config cache. A row is written in the same transaction as every
 * config change; after commit the control plane sends `NOTIFY config_changes, '<seq>'` (wake-up only).
 */
export const configChanges = pgTable('config_changes', {
  seq: bigserial('seq', { mode: 'number' }).primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  orgId: uuid('org_id').notNull(),
  createdAt: createdAt(),
});

/**
 * Metering store, written by the gateway only (the control plane reads it for dashboards). One row per
 * (minute bucket, org, pool, key, model), flushed with an additive upsert
 * (`ON CONFLICT DO UPDATE SET x = x + EXCLUDED.x`) so several gateway instances add up.
 * `pool_id` and `key_id` deliberately have no foreign keys: usage history must outlive deleted pools and keys, and the
 * gateway must never fail a flush because of a config race. Rows are removed with the organisation.
 */
export const usageRecords = pgTable(
  'usage_records',
  {
    /** Start of the minute (UTC). */
    bucket: timestamp('bucket', { withTimezone: true }).notNull(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    poolId: uuid('pool_id').notNull(),
    keyId: uuid('key_id').notNull(),
    model: text('model').notNull(),
    tokensIn: bigint('tokens_in', { mode: 'number' }).notNull().default(0),
    tokensOut: bigint('tokens_out', { mode: 'number' }).notNull().default(0),
    requests: bigint('requests', { mode: 'number' }).notNull().default(0),
    errors: bigint('errors', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.bucket, t.orgId, t.poolId, t.keyId, t.model] }),
    index('usage_records_org_bucket_idx').on(t.orgId, t.bucket),
  ],
);

/** One row per flushed batch: a retry after an ambiguous commit hits the primary key and becomes a no-op. */
export const usageFlushes = pgTable('usage_flushes', {
  batchId: uuid('batch_id').primaryKey(),
  createdAt: createdAt(),
});
