/**
 * Fractional-index position strings (the `position` field on TaskCreated/
 * ListCreated/TaskMoved — lib/events/schemas.ts): generating a key
 * strictly between two neighbours is what lets drag-and-drop reordering
 * be ONE event, not a renumbering pass across every sibling.
 *
 * `DIGITS` order matches plain JS string comparison exactly (ASCII
 * '0'-'9' < 'A'-'Z' < 'a'-'z'), so `positionA < positionB` as strings is
 * always the correct sort order — no custom comparator needed anywhere
 * position strings are sorted (task lists, the projection, tests).
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length

function digitAt(value: string, index: number, atEnd: number): number {
  return index < value.length ? DIGITS.indexOf(value[index]!) : atEnd
}

/**
 * A position string strictly between `lo` and `hi` (either bound may be
 * omitted for "start of list" / "end of list"). Throws if `lo >= hi`
 * lexicographically, which would mean the caller passed corrupted/
 * unsorted neighbours.
 */
export function positionBetween(lo: string | null, hi: string | null): string {
  if (lo !== null && hi !== null && lo >= hi) {
    throw new Error(`positionBetween: lo (${lo}) must sort before hi (${hi})`)
  }

  let result = ''
  let i = 0
  for (;;) {
    const a = digitAt(lo ?? '', i, 0)
    const b = digitAt(hi ?? '', i, BASE)

    if (b - a > 1) {
      result += DIGITS[Math.floor((a + b) / 2)]
      return result
    }
    // No room yet at this digit (a and b are equal, or adjacent with no
    // gap) — lock in `a` and go one digit deeper to find room.
    result += DIGITS[a]
    i += 1
  }
}

/** Convenience for appending N items to an empty list, or one item to the
 * end of an existing one: positions strictly increasing, each computed
 * from the previous. */
export function positionsAppending(count: number, after: string | null = null): string[] {
  const positions: string[] = []
  let prev = after
  for (let i = 0; i < count; i++) {
    const next = positionBetween(prev, null)
    positions.push(next)
    prev = next
  }
  return positions
}
