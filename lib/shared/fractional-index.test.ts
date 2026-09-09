import { describe, expect, it } from 'vitest'
import { positionBetween, positionsAppending } from './fractional-index'

describe('positionBetween', () => {
  it('start of an empty list', () => {
    const p = positionBetween(null, null)
    expect(p.length).toBeGreaterThan(0)
  })

  it('after the last item', () => {
    const first = positionBetween(null, null)
    const second = positionBetween(first, null)
    expect(second > first).toBe(true)
  })

  it('before the first item', () => {
    const first = positionBetween(null, null)
    const before = positionBetween(null, first)
    expect(before < first).toBe(true)
  })

  it('strictly between two neighbours, repeatedly, without ever colliding', () => {
    const lo = positionBetween(null, null)
    let hi = positionBetween(lo, null)
    const seen = new Set([lo, hi])
    for (let i = 0; i < 200; i++) {
      const mid = positionBetween(lo, hi)
      expect(mid > lo).toBe(true)
      expect(mid < hi).toBe(true)
      expect(seen.has(mid)).toBe(false)
      seen.add(mid)
      hi = mid // keep squeezing into the same, ever-shrinking gap
    }
  })

  it('throws if lo does not sort before hi', () => {
    expect(() => positionBetween('b', 'a')).toThrow()
    expect(() => positionBetween('a', 'a')).toThrow()
  })

  it('string comparison order matches DIGITS order (0-9 < A-Z < a-z)', () => {
    expect('0' < '9').toBe(true)
    expect('9' < 'A').toBe(true)
    expect('Z' < 'a').toBe(true)
  })
})

describe('positionsAppending', () => {
  it('produces N strictly increasing positions', () => {
    const positions = positionsAppending(10)
    const sorted = [...positions].sort()
    expect(positions).toEqual(sorted)
    expect(new Set(positions).size).toBe(10)
  })

  it('continues after an existing tail position', () => {
    const [tail] = positionsAppending(1)
    const [next] = positionsAppending(1, tail)
    expect(next! > tail!).toBe(true)
  })
})
