import { v7 as uuidv7 } from 'uuid'
import type { AnyEvent, EventOfType, EventType } from './schemas'
import type { EntityType, VectorClock } from './envelope'

export const CURRENT_SCHEMA_VERSION = 1

export interface CreateEventInput<T extends EventType> {
  type: T
  actor_id: string
  device_id: string
  entity_id: string
  entity_type: EntityType
  payload: EventOfType<T>['payload']
  /** The device's local vector clock BEFORE this event, already incremented for this write. */
  vector_clock: VectorClock
}

/**
 * Mints a new event on the client: assigns a UUIDv7 id, stamps
 * `client_timestamp` from the local clock, and leaves `server_timestamp`
 * null until the server accepts it (lib/db/schema.ts, POST /sync).
 *
 * Does not touch the vector clock itself — incrementing the local device's
 * counter is the caller's responsibility (lib/domain/vector-clock.ts
 * `increment`), because the factory must stay free of hidden mutable state
 * to keep event construction reproducible in tests.
 */
export function createEvent<T extends EventType>(input: CreateEventInput<T>): AnyEvent {
  return {
    id: uuidv7(),
    schema_version: CURRENT_SCHEMA_VERSION,
    actor_id: input.actor_id,
    device_id: input.device_id,
    entity_id: input.entity_id,
    entity_type: input.entity_type,
    client_timestamp: new Date().toISOString(),
    server_timestamp: null,
    vector_clock: input.vector_clock,
    type: input.type,
    payload: input.payload,
  } as AnyEvent
}
