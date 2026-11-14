import {
  bigint,
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
    createdAt: createdAt(),
  },
  (t) => [unique('pools_org_id_name_unique').on(t.orgId, t.name)],
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
