import { describe, expect, it } from 'vitest'
import { AA_NORMAL_TEXT, AA_UI_COMPONENT, contrastRatio } from './contrast'
import { deriveTheme, type ThemeTokens } from './palette'

function assertAccessible(tokens: ThemeTokens) {
  expect(contrastRatio(tokens.fg, tokens.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  expect(contrastRatio(tokens.fgMuted, tokens.bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  expect(contrastRatio(tokens.accentFg, tokens.accent)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  expect(contrastRatio(tokens.border, tokens.bg)).toBeGreaterThanOrEqual(AA_UI_COMPONENT)
}

describe('deriveTheme', () => {
  it('a well-behaved base color (blue) derives an accessible light + dark palette', () => {
    const result = deriveTheme('#3b82f6')
    expect(result.ok).toBe(true)
    assertAccessible(result.light)
    assertAccessible(result.dark)
  })

  it('light mode background is light, dark mode background is dark, for the same base color', () => {
    const result = deriveTheme('#3b82f6')
    expect(contrastRatio(result.light.bg, '#ffffff')).toBeLessThan(contrastRatio(result.dark.bg, '#ffffff'))
  })

  it('a deliberately extreme base color (pure yellow, very light) still derives an accessible palette', () => {
    // Pure yellow is the canonical hard case for accessible-palette
    // generators — high lightness, high chroma, terrible contrast against
    // white. This is exactly what the auto-correction step exists for.
    const result = deriveTheme('#ffff00')
    expect(result.ok).toBe(true)
    assertAccessible(result.light)
    assertAccessible(result.dark)
    expect(result.adjustments.length).toBeGreaterThan(0)
  })

  it('a deliberately extreme base color (very light, low chroma near-white) still derives an accessible palette', () => {
    const result = deriveTheme('#fefefe')
    expect(result.ok).toBe(true)
    assertAccessible(result.light)
    assertAccessible(result.dark)
  })

  it('a near-black base color still derives an accessible palette', () => {
    const result = deriveTheme('#0a0a0a')
    expect(result.ok).toBe(true)
    assertAccessible(result.light)
    assertAccessible(result.dark)
  })

  it('an unparseable color is rejected, not silently shipped', () => {
    const result = deriveTheme('not-a-color')
    expect(result.ok).toBe(false)
  })

  it('preserves the requested hue rather than converging on gray', () => {
    // A mid-saturation violet should still read as violet, not have its
    // chroma corrected away — only lightness moves during correction.
    const result = deriveTheme('oklch(0.6 0.2 300)')
    expect(result.ok).toBe(true)
    // Accent should retain meaningful chroma (not have been flattened to
    // near-gray by correction).
    expect(result.light.accent).not.toBe(result.light.bg)
  })
})
