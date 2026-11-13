import {
  bigserial,
  boolean,
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
