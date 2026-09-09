import type { VectorClock } from '@/lib/events/envelope'
import { compare } from './vector-clock'

/**
 * Operation-based merge, LWW-Register default (docs/DECISIONS.md
 * "Conflict resolution"). Every mergeable field on an entity is resolved
 * by one of the strategies below, applied over ALL writes that field ever
 * received (not incrementally) — see reducer.ts for why a full replay
 * makes this exact rather than an approximation.
 *
 * | Field                                   | Merge type                        |
 * |------------------------------------------|-----------------------------------|
 * | title, due_date, priority, note,          | LwwRegister (default)             |
 * | list.name, list.archived                  |                                    |
 * | completed + completed_at                  | LwwRegister over the pair         |
 * | list_id + position ("move")               | LwwRegister over the atomic pair  |
 * | tags                                      | LwwElementSet, add-biased         |
 * | deleted                                   | RestoreWins                       |
 */

export interface FieldWrite<V> {
  value: V
  clock: VectorClock
  client_timestamp: string
  device_id: string
  event_id: string
}

/**
 * Deterministic total order over any two writes that tiebreaks concurrent
 * (vector-clock-incomparable) writes to the same field: later
 * client_timestamp wins; ties broken by device_id, then event_id (UUIDv7,
 * so this is only reached if two devices somehow used identical
 * timestamps). Total because client_timestamp/device_id/event_id are
 * never all equal for two distinct events.
 */
function tiebreakWins<V>(a: FieldWrite<V>, b: FieldWrite<V>): boolean {
  if (a.client_timestamp !== b.client_timestamp) return a.client_timestamp > b.client_timestamp
  if (a.device_id !== b.device_id) return a.device_id > b.device_id
  return a.event_id > b.event_id
}

/**
 * The maximal elements of the partial order induced by vector-clock
 * dominance: writes with no other write in the set that causally
 * dominates them. Pure function of the SET of writes — independent of the
 * order they're supplied in or discovered, which is what makes
 * `resolveField`/`resolveBiasedBoolean` order-independent and therefore
 * safe to call from a reducer that must not care about event array order.
 */
function maximalFrontier<V>(writes: FieldWrite<V>[]): FieldWrite<V>[] {
  return writes.filter(
    (candidate) => !writes.some((other) => other !== candidate && compare(other.clock, candidate.clock) === 'after'),
  )
}

/**
 * LwwRegister: the write with the causally-latest clock wins; concurrent
 * writes are broken by `tiebreakWins`. Used for every plain scalar field,
 * and for compound "one write, several columns" fields (completed/
 * completed_at, list_id/position) by treating the pair as a single value.
 */
export function resolveField<V>(writes: FieldWrite<V>[]): FieldWrite<V> {
  if (writes.length === 0) {
    throw new Error('resolveField called with no writes')
  }
  const frontier = maximalFrontier(writes)
  return frontier.reduce((best, candidate) => (tiebreakWins(candidate, best) ? candidate : best))
}

/**
 * Shared by `tags` (LwwElementSet, add-biased) and `deleted` (RestoreWins,
 * i.e. delete-biased-false): resolves like `resolveField`, except when the
 * winning clock is genuinely ambiguous (a concurrent frontier of more than
 * one write) the value matching `biasValue` wins over the alternative
 * value, rather than falling straight to the timestamp tiebreak. A write
 * that causally dominates the others still always wins outright — the
 * bias only ever fires on true concurrency, never overriding causality.
 */
export function resolveBiasedBoolean(writes: FieldWrite<boolean>[], biasValue: boolean): FieldWrite<boolean> {
  if (writes.length === 0) {
    throw new Error('resolveBiasedBoolean called with no writes')
  }
  const frontier = maximalFrontier(writes)
  if (frontier.length === 1) return frontier[0]!
  const biased = frontier.filter((w) => w.value === biasValue)
  const pool = biased.length > 0 ? biased : frontier
  return pool.reduce((best, candidate) => (tiebreakWins(candidate, best) ? candidate : best))
}
