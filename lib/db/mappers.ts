import type { AnyEvent } from '@/lib/events/schemas'
import type { events } from './schema'

type EventRow = typeof events.$inferSelect

/**
 * DB row -> domain event. Postgres round-trips timestamps as `Date` and
 * `user_seq` as `bigint`; the domain layer (lib/events, lib/domain) only
 * ever deals in the wire/Zod shape (ISO strings), so every read from
 * `events` goes through here before reaching `reduce()`.
 */
export function rowToEvent(row: EventRow): AnyEvent {
  return {
    id: row.id,
    schema_version: row.schemaVersion,
    actor_id: row.actorId,
    device_id: row.deviceId,
    entity_id: row.entityId,
    entity_type: row.entityType,
    client_timestamp: row.clientTimestamp.toISOString(),
    server_timestamp: row.serverTimestamp.toISOString(),
    vector_clock: row.vectorClock as AnyEvent['vector_clock'],
    type: row.type,
    payload: row.payload,
  } as AnyEvent
}
