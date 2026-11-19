import {
  bigint,
  doublePrecision,
  integer,
  bigserial,
  boolean,
  index,
  jsonb,
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
  /** Rate limits enforced by the gateway (null = unlimited). Per minute, and tokens per UTC day. */
  limitRequestsPerMinute: integer('limit_requests_per_minute'),
  limitTokensPerMinute: integer('limit_tokens_per_minute'),
  limitTokensPerDay: bigint('limit_tokens_per_day', { mode: 'number' }),
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
    /** Admin override of the compute backend (`cpu` | `gpu`); null = the device decides (its own setting, else the fastest). */
    computeBackend: text('compute_backend'),
    /** Admin override of the engine's context window in tokens; null = the device decides. */
    maxContextTokens: integer('max_context_tokens'),
    /** Admin override: keep the device's display on while the app is open (some devices only use the GPU at full speed then); null = the device decides. */
    keepScreenOn: boolean('keep_screen_on'),
    /** Admin override: enable multi-token prediction (speculative decoding with the bundle's drafter); null = the device decides. */
    enableMtp: boolean('enable_mtp'),
    createdAt: createdAt(),
  },
  (t) => [index('nodes_pool_idx').on(t.poolId)],
);

/**
 * A pending device enrollment, created by an admin from the web app. The code shown to the admin is
 * `<lookupId>-<secret>` (Crockford base32, 4 + 6 chars). The lookup id is public (unique among live enrollments);
 * the secret is the PAKE password (CPace is a balanced PAKE, so the server must know it; the row lives at most
 * ~10 minutes and is deleted when the device enrols). `sessionSid`/`sessionIsk` hold the state of the PAKE round in
 * progress, so any instance can serve any round.
 */
export const enrollments = pgTable('enrollments', {
  id: id(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'cascade' }),
  poolId: uuid('pool_id')
    .notNull()
    .references(() => pools.id, { onDelete: 'cascade' }),
  createdBy: text('created_by').notNull(),
  lookupId: text('lookup_id').notNull().unique(),
  secret: text('secret').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  /** PAKE runs started (each is one password guess); the enrollment dies at `maxAttempts`. */
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  sessionSid: text('session_sid'),
  sessionIsk: text('session_isk'),
  createdAt: createdAt(),
});

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
  /** What the engine actually runs on (`cpu` | `gpu`) and its context window, as reported by the node. */
  backend: text('backend'),
  maxContextTokens: integer('max_context_tokens'),
  /** What the loaded model accepts besides text (`image`, `audio`; comma separated, empty = text only). */
  modalities: text('modalities'),
  /** The gateway instance holding the connection (`gateway_instances.id`). */
  gatewayId: text('gateway_id'),
  /** Ids (hex, comma separated) of the gateway keys the device trusts; used to check a key rotation. */
  gatewayKeys: text('gateway_keys'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Running gateway instances (each heartbeats every few seconds); written by the gateways only. */
export const gatewayInstances = pgTable('gateway_instances', {
  id: text('id').primaryKey(),
  /** Internal address other gateways forward requests to (never exposed outside the cluster). */
  address: text('address').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A benchmark of a pool: one fixed, platform-supplied prompt run on every connected node of the pool, one node at a
 * time. The gateway that holds a node runs its row in `benchmark_results`.
 */
export const benchmarks = pgTable(
  'benchmarks',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    poolId: uuid('pool_id')
      .notNull()
      .references(() => pools.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('benchmarks_pool_idx').on(t.poolId, t.createdAt)],
);

export const benchmarkResults = pgTable(
  'benchmark_results',
  {
    id: id(),
    benchmarkId: uuid('benchmark_id')
      .notNull()
      .references(() => benchmarks.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => nodes.id, { onDelete: 'cascade' }),
    /** pending | running | done | failed */
    status: text('status').notNull().default('pending'),
    error: text('error'),
    /** Time to first token, total time and generated pieces; tokens per second is measured after the first token. */
    ttftMs: integer('ttft_ms'),
    totalMs: integer('total_ms'),
    tokens: integer('tokens'),
    tokensPerSec: doublePrecision('tokens_per_sec'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [unique('benchmark_results_unique').on(t.benchmarkId, t.nodeId)],
);

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

/** The model a pool serves (every node of the pool holds it). One model per pool: `pool_id` is unique. */
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
  (t) => [
    primaryKey({ columns: [t.poolId, t.modelId] }),
    unique('pool_models_pool_id_unique').on(t.poolId),
  ],
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
    /** Rate limits enforced by the gateway (null = unlimited). Per minute, and tokens per UTC day. */
    limitRequestsPerMinute: integer('limit_requests_per_minute'),
    limitTokensPerMinute: integer('limit_tokens_per_minute'),
    limitTokensPerDay: bigint('limit_tokens_per_day', { mode: 'number' }),
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

/**
 * Audit trail, visible to organisation admins. Written by the control plane (every API mutation, see
 * plugins/audit.ts) and by the gateway (node and key security events, never per request). `org_id` is mandatory:
 * every query is tenant-scoped. `actor_id` and `entity_id` are text because actors are emails, key ids or node ids.
 * `metadata` never holds prompts, completions or key material. Pruned after 90 days by the `control-plane-audit-prune`
 * CronJob.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** `control_plane` or `gateway`. */
    source: text('source').notNull(),
    /** `user`, `api_key`, `node` or `system`. */
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    /** Dotted verb, e.g. `pool.create`, `member.role_change`, `node.connect_rejected`. */
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    /** `success`, `denied` or `failed`. */
    outcome: text('outcome').notNull(),
    ip: text('ip'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('audit_logs_org_time_idx').on(t.orgId, t.occurredAt.desc()),
    index('audit_logs_time_idx').on(t.occurredAt),
  ],
);

/**
 * Per-organisation operational metrics of the gateway, one row per minute and pool, written by the gateway only (in
 * additive batches, never fail-closed). Requests, errors and tokens live in `usage_records`; this holds what that
 * lacks: requests refused by limits (429), requests no node could serve (502/503), latency histograms and the peak
 * in-flight count. Histograms are counts per bucket (bounds in `dto/metrics.ts`), so rows of several gateway instances
 * and several minutes add up exactly. No prompts, completions or key material. Pruned by `control-plane-metrics-prune`
 * (default 7 days).
 */
export const poolMetrics = pgTable(
  'pool_metrics',
  {
    bucket: timestamp('bucket', { withTimezone: true }).notNull(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    poolId: uuid('pool_id').notNull(),
    rateLimited: bigint('rate_limited', { mode: 'number' }).notNull().default(0),
    unavailable: bigint('unavailable', { mode: 'number' }).notNull().default(0),
    peakInFlight: integer('peak_in_flight').notNull().default(0),
    /** Total request duration, counts per bucket. */
    latencyHist: integer('latency_hist').array().notNull(),
    /** Time until the first node event, counts per bucket. */
    ttftHist: integer('ttft_hist').array().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bucket, t.orgId, t.poolId] }),
    index('pool_metrics_org_bucket_idx').on(t.orgId, t.bucket),
    index('pool_metrics_bucket_idx').on(t.bucket),
  ],
);

/**
 * Telemetry history of single nodes, one row per node and minute (the last report of that minute), written by the
 * gateway from the nodes' `Telemetry` messages. `org_id`/`pool_id` are the node's at the time. Pruned together with
 * `pool_metrics`.
 */
export const nodeMetrics = pgTable(
  'node_metrics',
  {
    bucket: timestamp('bucket', { withTimezone: true }).notNull(),
    nodeId: uuid('node_id').notNull(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    poolId: uuid('pool_id').notNull(),
    cpuPercent: doublePrecision('cpu_percent'),
    memoryUsedMb: integer('memory_used_mb'),
    batteryPercent: integer('battery_percent'),
    charging: boolean('charging'),
    temperatureC: doublePrecision('temperature_c'),
    inFlight: integer('in_flight').notNull().default(0),
    tokensPerSec: doublePrecision('tokens_per_sec'),
  },
  (t) => [
    primaryKey({ columns: [t.bucket, t.nodeId] }),
    index('node_metrics_org_bucket_idx').on(t.orgId, t.bucket),
    index('node_metrics_bucket_idx').on(t.bucket),
  ],
);
