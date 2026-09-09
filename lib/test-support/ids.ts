/**
 * Deterministic, schema-valid UUIDv7-shaped ids and device ids for tests.
 * Not real UUIDv7 (no genuine embedded timestamp) — just satisfies
 * `envelope.ts` UuidV7's version-nibble check with unique, readable
 * values, so tests stay reproducible instead of depending on `uuid`'s
 * randomness.
 */
let counter = 0

export function fakeId(): string {
  counter += 1
  const hex = counter.toString(16).padStart(12, '0')
  return `00000000-0000-7000-8000-${hex}`
}

export function resetFakeIds(): void {
  counter = 0
}

export const DEVICE_A = '00000000-0000-4000-8000-00000000000a'
export const DEVICE_B = '00000000-0000-4000-8000-00000000000b'
export const USER_1 = '00000000-0000-4000-8000-000000000001'
export const USER_2 = '00000000-0000-4000-8000-000000000002'
