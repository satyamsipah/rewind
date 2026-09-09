import { describe, expect, it } from 'vitest'
import { AA_NORMAL_TEXT, AA_UI_COMPONENT, contrastRatio, meetsAA } from './contrast'

describe('contrastRatio (WCAG 2.x)', () => {
  it('black on white is the maximum, 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
  })

  it('identical colors have a ratio of 1', () => {
    expect(contrastRatio('#808080', '#808080')).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#000000'), 5)
  })

  it('a well-known AA-passing pair (black text on a light gray)', () => {
    expect(meetsAA('#000000', '#e5e5e5', AA_NORMAL_TEXT)).toBe(true)
  })

  it('a well-known AA-failing pair (mid-gray on mid-gray)', () => {
    expect(meetsAA('#999999', '#aaaaaa', AA_NORMAL_TEXT)).toBe(false)
  })

  it('AA_UI_COMPONENT (3:1) is a lower bar than AA_NORMAL_TEXT (4.5:1)', () => {
    expect(AA_UI_COMPONENT).toBeLessThan(AA_NORMAL_TEXT)
  })
})
