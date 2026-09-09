import type { AppState } from './state'

/**
 * Deterministic serialisation of AppState: sorted object keys at every
 * level (which sorts `tasks`/`lists` Records by entity id, and sorts each
 * entity's own fields alphabetically too), used for the byte-for-byte
 * snapshot-vs-full-replay comparison (snapshot.test.ts) and as the actual
 * on-disk format for `snapshots.state` (lib/db/schema.ts) so two
 * snapshots of identical state hash identically.
 *
 * Tags are expected to already be sorted by the reducer (reducer.ts
 * `buildTask`); this does not re-sort array contents, only object keys.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeysDeep((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

export function canonical(state: AppState): string {
  return JSON.stringify(sortKeysDeep(state))
}
