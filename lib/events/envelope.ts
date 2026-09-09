import { z } from 'zod'

/**
 * UUIDv7 for event ids, not v4.
 *
 * v7 = 48-bit big-endian Unix-ms timestamp || version/variant bits || ~74
 * bits of randomness.
 *
 * 1. Index locality. `events.id` is the primary key of an append-only table
 *    that only ever grows. v4 is uniformly random, so every insert lands on
 *    a random B-tree leaf: cache misses, page splits, and index bloat that
 *    worsen as the table grows. v7 appends to the right-hand edge of the
 *    index, the same access pattern a `bigserial` gives you, but...
 * 2. ...unlike a DB sequence, and like v4, the id is client-mintable while
 *    fully offline. The client mints the id before the event has ever seen
 *    a network. That id is exactly what makes sync idempotent — the server
 *    dedupes on it (CLAUDE.md principle 4 / lib/db/schema.ts `events.id`).
 * 3. Roughly-chronological keyset pagination and human-readable creation
 *    instants when eyeballing the raw log.
 *
 * Deliberately NOT relied on: the embedded timestamp comes from an
 * untrusted client clock and must never be used to order events across
 * devices. Causality is the vector clock (./envelope.ts VectorClock,
 * lib/domain/vector-clock.ts); the settled server order is
 * `events.user_seq` (lib/db/schema.ts). v7 ordering is a storage
 * optimisation, never a happens-before relation.
 */
const UUID_V7_VERSION_NIBBLE = '7'

export const UuidV7 = z
  .string()
  .uuid()
  .refine((v) => v[14] === UUID_V7_VERSION_NIBBLE, {
    message: 'expected a UUIDv7 (version nibble at index 14 must be "7")',
  })

/**
 * Vector clock keyed by device_id (not actor_id): the same user syncing
 * from two devices offline is exactly the case principle 5 requires to
 * merge, so causality must be tracked per node, not per person.
 */
export const VectorClock = z.record(z.string().uuid(), z.number().int().nonnegative())
export type VectorClock = z.infer<typeof VectorClock>

/** 'user' is the entity type for preference events (PreferenceSet) — the
 * entity_id is the user's own id, since a preference belongs to the
 * person, not to any task or list. */
export const EntityType = z.enum(['task', 'list', 'user'])
export type EntityType = z.infer<typeof EntityType>

/**
 * Shared envelope for every event. `device_id` and `entity_type` are
 * approved additions to the field list named in CLAUDE.md principle 2 —
 * see docs/DECISIONS.md "Event envelope extensions".
 */
export const EventEnvelope = z.object({
  id: UuidV7,
  schema_version: z.number().int().positive(),
  actor_id: z.string().uuid(),
  device_id: z.string().uuid(),
  entity_id: z.string().uuid(),
  entity_type: EntityType,
  client_timestamp: z.string().datetime({ offset: true }),
  // null until the server accepts the event and stamps it (lib/db/schema.ts).
  server_timestamp: z.string().datetime({ offset: true }).nullable(),
  vector_clock: VectorClock,
})
export type EventEnvelope = z.infer<typeof EventEnvelope>
