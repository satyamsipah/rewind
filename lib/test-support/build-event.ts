import type { EntityType, VectorClock } from '@/lib/events/envelope'
import type { AnyEvent, EventOfType, EventType } from '@/lib/events/schemas'
import { CURRENT_SCHEMA_VERSION } from '@/lib/events/factory'
import { fakeId } from './ids'

export interface BuildEventOptions<T extends EventType> {
  type: T
  entity_id: string
  entity_type: EntityType
  payload: EventOfType<T>['payload']
  actor_id?: string
  device_id?: string
  vector_clock?: VectorClock
  client_timestamp?: string
  server_timestamp?: string | null
  id?: string
}

let tsCounter = 0

/** Monotonically increasing ISO timestamp, so a linear (non-concurrent)
 * sequence of buildEvent() calls resolves in call order under LwwRegister
 * even when every event shares the same (default {}) vector clock — the
 * tiebreak in merge.ts falls back to client_timestamp. Concurrency tests
 * override client_timestamp/vector_clock explicitly. */
function nextTimestamp(): string {
  tsCounter += 1
  return new Date(Date.UTC(2026, 0, 1, 0, 0, tsCounter)).toISOString()
}

export function resetFakeTimestamps(): void {
  tsCounter = 0
}

const clockCounters = new Map<string, number>()

/**
 * Default vector clock: `{ [device_id]: n }`, incrementing per device.
 * Mirrors what a real device actually does (lib/domain/vector-clock.ts
 * `increment` bumps only its own component before minting an event) —
 * without this, a linear sequence of same-device test events would all
 * carry the SAME default clock and compare as mutually "equal" rather
 * than a causal chain, which is indistinguishable from true concurrency
 * to merge.ts's frontier logic. Tests that want genuine concurrency pass
 * `vector_clock` explicitly instead.
 */
function nextClock(deviceId: string): VectorClock {
  const next = (clockCounters.get(deviceId) ?? 0) + 1
  clockCounters.set(deviceId, next)
  return { [deviceId]: next }
}

export function resetFakeClocks(): void {
  clockCounters.clear()
}

/**
 * Builds a fully-formed, schema-valid event for tests without going
 * through lib/events/factory.ts (which mints real UUIDv7s and reads
 * `Date.now()` — exactly the impurity the domain layer's tests need to
 * avoid depending on). Every field can be overridden so tests can set up
 * precise vector-clock scenarios.
 */
export function buildEvent<T extends EventType>(options: BuildEventOptions<T>): AnyEvent {
  const device_id = options.device_id ?? '00000000-0000-4000-8000-00000000000a'
  return {
    id: options.id ?? fakeId(),
    schema_version: CURRENT_SCHEMA_VERSION,
    actor_id: options.actor_id ?? '00000000-0000-4000-8000-000000000001',
    device_id,
    entity_id: options.entity_id,
    entity_type: options.entity_type,
    client_timestamp: options.client_timestamp ?? nextTimestamp(),
    server_timestamp: options.server_timestamp ?? null,
    vector_clock: options.vector_clock ?? nextClock(device_id),
    type: options.type,
    payload: options.payload,
  } as AnyEvent
}
