import type { VectorClock } from '@/lib/events/envelope'

/**
 * Single home for vector-clock comparison logic (per .claude/rules/domain.md).
 * All four relations are unit-tested in vector-clock.test.ts: equal, before,
 * after, concurrent.
 */
export type ClockOrder = 'equal' | 'before' | 'after' | 'concurrent'

function keysOf(a: VectorClock, b: VectorClock): Set<string> {
  return new Set([...Object.keys(a), ...Object.keys(b)])
}

function at(clock: VectorClock, key: string): number {
  return clock[key] ?? 0
}

/**
 * Compares two vector clocks. `a` is "before" `b` when every component of
 * `a` is <= the corresponding component of `b` and at least one is
 * strictly less (i.e. `a` causally happened-before `b`). "after" is the
 * mirror image. Anything else — some components of `a` greater, others
 * lesser — is "concurrent".
 */
export function compare(a: VectorClock, b: VectorClock): ClockOrder {
  let aLessSomewhere = false
  let aGreaterSomewhere = false

  for (const key of keysOf(a, b)) {
    const av = at(a, key)
    const bv = at(b, key)
    if (av < bv) aLessSomewhere = true
    else if (av > bv) aGreaterSomewhere = true
  }

  if (!aLessSomewhere && !aGreaterSomewhere) return 'equal'
  if (aLessSomewhere && !aGreaterSomewhere) return 'before'
  if (aGreaterSomewhere && !aLessSomewhere) return 'after'
  return 'concurrent'
}

/** True when `a` causally dominates or equals `b` (b happened-before or at the same time as a). */
export function descends(a: VectorClock, b: VectorClock): boolean {
  const order = compare(a, b)
  return order === 'after' || order === 'equal'
}

/** Component-wise max — the clock merge used when a device learns of another device's clock. */
export function merge(a: VectorClock, b: VectorClock): VectorClock {
  const result: VectorClock = {}
  for (const key of keysOf(a, b)) {
    result[key] = Math.max(at(a, key), at(b, key))
  }
  return result
}

/** Bumps one device's own component. Used by the client before minting a new event. */
export function increment(clock: VectorClock, deviceId: string): VectorClock {
  return { ...clock, [deviceId]: at(clock, deviceId) + 1 }
}
