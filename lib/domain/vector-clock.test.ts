import { describe, expect, it } from 'vitest'
import { compare, descends, increment, merge } from './vector-clock'

const A = 'device-a'
const B = 'device-b'

describe('vector-clock compare', () => {
  it('equal: identical clocks', () => {
    expect(compare({ [A]: 2, [B]: 3 }, { [A]: 2, [B]: 3 })).toBe('equal')
  })

  it('equal: two empty clocks', () => {
    expect(compare({}, {})).toBe('equal')
  })

  it('before: a is dominated by b', () => {
    expect(compare({ [A]: 1, [B]: 2 }, { [A]: 2, [B]: 2 })).toBe('before')
  })

  it('after: a dominates b', () => {
    expect(compare({ [A]: 2, [B]: 2 }, { [A]: 1, [B]: 2 })).toBe('after')
  })

  it('concurrent: neither dominates', () => {
    expect(compare({ [A]: 2, [B]: 0 }, { [A]: 0, [B]: 2 })).toBe('concurrent')
  })

  it('concurrent: missing keys default to 0 on both sides', () => {
    expect(compare({ [A]: 1 }, { [B]: 1 })).toBe('concurrent')
  })
})

describe('descends', () => {
  it('true when a strictly dominates b', () => {
    expect(descends({ [A]: 2 }, { [A]: 1 })).toBe(true)
  })

  it('true when equal', () => {
    expect(descends({ [A]: 1 }, { [A]: 1 })).toBe(true)
  })

  it('false when concurrent', () => {
    expect(descends({ [A]: 1 }, { [B]: 1 })).toBe(false)
  })

  it('false when b dominates a', () => {
    expect(descends({ [A]: 1 }, { [A]: 2 })).toBe(false)
  })
})

describe('merge', () => {
  it('takes the component-wise max', () => {
    expect(merge({ [A]: 3, [B]: 1 }, { [A]: 1, [B]: 5 })).toEqual({ [A]: 3, [B]: 5 })
  })

  it('is commutative', () => {
    const a = { [A]: 3, [B]: 1 }
    const b = { [A]: 1, [B]: 5 }
    expect(merge(a, b)).toEqual(merge(b, a))
  })
})

describe('increment', () => {
  it('bumps only the given device from a fresh clock', () => {
    expect(increment({}, A)).toEqual({ [A]: 1 })
  })

  it('bumps only the given device, leaving others untouched', () => {
    expect(increment({ [A]: 1, [B]: 4 }, A)).toEqual({ [A]: 2, [B]: 4 })
  })
})
