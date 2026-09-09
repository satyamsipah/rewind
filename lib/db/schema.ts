import { relations, sql } from 'drizzle-orm'
import { bigint, integer, jsonb, pgTable, primaryKey, text, timestamp, unique } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Auth.js v5 tables (@auth/drizzle-adapter's expected shape — column names
// are fixed by the adapter, not our convention).
// ---------------------------------------------------------------------------

export const users = pgTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date', withTimezone: true }),
  image: text('image'),
})

export const accounts = pgTable(
  'account',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })],
)

export const sessions = pgTable('session', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
})

export const verificationTokens = pgTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date', withTimezone: true }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
)

// ---------------------------------------------------------------------------
// Rewind domain tables
// ---------------------------------------------------------------------------

export const devices = pgTable('devices', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
})

/**
 * The event log. Append-only: a hand-written migration
 * (drizzle/0001_append_only_trigger.sql) installs a trigger that raises on
 * any UPDATE/DELETE/TRUNCATE, plus a REVOKE as defence in depth — Drizzle
 * has no first-class way to express triggers, so that migration is
 * checked in alongside the generated ones.
 *
 * `id` is the UUIDv7 the client minted (lib/events/factory.ts) and is the
 * dedupe target (`ON CONFLICT (id) DO NOTHING` in the sync route) that
 * makes replay idempotent — CLAUDE.md principle 4.
 *
 * `user_seq` is NOT a Postgres sequence/identity column. It's allocated by
 * the application after taking a row lock on `event_sequences` (see
 * lib/db/sequence.ts), because a DB sequence or `server_timestamp` are
 * both allocated pre-commit and are therefore NOT safe cursors for
 * incremental sync — see docs/DECISIONS.md "Why user_seq, not a timestamp
 * cursor".
 */
export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').notNull(),
    deviceId: text('device_id').notNull(),
    entityId: text('entity_id').notNull(),
    entityType: text('entity_type').notNull(),
    type: text('type').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    payload: jsonb('payload').notNull(),
    clientTimestamp: timestamp('client_timestamp', { withTimezone: true }).notNull(),
    serverTimestamp: timestamp('server_timestamp', { withTimezone: true }).notNull().defaultNow(),
    vectorClock: jsonb('vector_clock').notNull(),
    userSeq: bigint('user_seq', { mode: 'bigint' }).notNull(),
  },
  (t) => [
    // The sync pull scan (`WHERE user_id = $1 AND user_seq > $since`) and
    // the gaplessness guarantee for user_seq itself.
    unique('events_user_seq_unique').on(t.userId, t.userSeq),
    // Time travel (GET /snapshot?at=) and the history timeline scan by
    // recency within a user.
    // (Composite non-unique indexes are declared in the hand-written
    // migration alongside the append-only trigger — see drizzle/0001.)
  ],
)

export const snapshots = pgTable('snapshots', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  upToUserSeq: bigint('up_to_user_seq', { mode: 'bigint' }).notNull(),
  upToServerTimestamp: timestamp('up_to_server_timestamp', { withTimezone: true }).notNull(),
  vectorClock: jsonb('vector_clock').notNull(),
  /** Canonical-serialised AppState (lib/domain/canonical.ts) — a cache,
   * never a source of truth. Invalidated by `reducerVersion` bumping. */
  state: jsonb('state').notNull(),
  reducerVersion: integer('reducer_version').notNull(),
  eventCount: integer('event_count').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const syncState = pgTable(
  'sync_state',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    lastPulledUserSeq: bigint('last_pulled_user_seq', { mode: 'bigint' }).notNull().default(sql`0`),
    deviceClock: jsonb('device_clock').notNull().default({}),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deviceId] })],
)

/** One row per user; `lastSeq FOR UPDATE` is how `user_seq` allocation is
 * serialised per-user (lib/db/sequence.ts). */
export const eventSequences = pgTable('event_sequences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  lastSeq: bigint('last_seq', { mode: 'bigint' }).notNull().default(sql`0`),
})

/**
 * Per-entity materialised view, rebuilt by replaying JUST that entity's
 * event slice (indexed by entity_id — see drizzle/0001) through
 * lib/domain/reduce(). Because it's always a full replay of a small,
 * bounded slice rather than an incremental field-by-field merge, this
 * sidesteps the well-known correctness gap of naive incremental
 * LWW-register updates under 3+-way concurrent writers (docs/
 * DECISIONS.md) — the cache is always exactly what a full replay would
 * produce, just scoped to one entity instead of the whole user.
 */
export const projections = pgTable(
  'projections',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    state: jsonb('state').notNull(),
    fieldClocks: jsonb('field_clocks').notNull().default({}),
    lastUserSeq: bigint('last_user_seq', { mode: 'bigint' }).notNull().default(sql`0`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.entityType, t.entityId] })],
)

/**
 * Undo/redo bookkeeping (POST /undo, POST /redo). NOT part of the
 * immutable event log — this table IS mutated in place, which is fine:
 * CLAUDE.md principle 1 constrains the domain event log, not internal
 * bookkeeping. See docs/DECISIONS.md "Undo/redo stack" for the state
 * machine (active -> undone -> superseded) this drives.
 */
export const undoEntries = pgTable('undo_entries', {
  id: bigint('id', { mode: 'bigint' })
    .primaryKey()
    .generatedAlwaysAsIdentity(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  deviceId: text('device_id').notNull(),
  eventId: text('event_id')
    .notNull()
    .references(() => events.id),
  compensatingEventId: text('compensating_event_id').references(() => events.id),
  state: text('state').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const usersRelations = relations(users, ({ many }) => ({
  devices: many(devices),
  events: many(events),
}))
