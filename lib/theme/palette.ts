import { clampChroma, formatCss, oklch } from 'culori'
import { AA_NORMAL_TEXT, AA_UI_COMPONENT, contrastRatio } from './contrast'

/**
 * Custom theme editor: derive a full, WCAG-AA-validated palette from one
 * user-picked base color (item 5, docs/DECISIONS.md "Custom theme
 * editor"). Built in OKLCH, not HSL — OKLCH's lightness channel tracks
 * PERCEIVED lightness across hues, so "step to L=0.55" means roughly the
 * same contrast-y result whether the hue is blue or yellow. HSL's
 * lightness famously doesn't have that property, which is exactly what
 * makes deriving a contrast-safe scale from it unreliable without
 * hue-specific correction hacks.
 *
 * Every derived (foreground, background) pair that the token system
 * actually renders text or a UI component with is checked; a failing
 * pair is corrected by walking the FOREGROUND member's lightness toward
 * the accessible extreme (never the reverse — the user's chosen hue is
 * preserved, only its lightness moves) until it passes. Only if no
 * accessible lightness exists at all (never observed in practice — L has
 * the full 0-1 range to search) does derivation report `ok: false`
 * instead of silently shipping an inaccessible pair.
 */

export interface ThemeTokens {
  bg: string
  surface: string
  border: string
  fg: string
  fgMuted: string
  accent: string
  accentHover: string
  accentSubtle: string
  accentFg: string
}

export interface DerivedTheme {
  light: ThemeTokens
  dark: ThemeTokens
  /** Human-readable log of every auto-correction made, shown by the
   * editor UI ("we darkened your accent slightly to keep it readable"). */
  adjustments: string[]
  ok: boolean
}

interface Swatch {
  l: number
  c: number
  h: number
}

/** Emits `oklch()` function notation, never hex — the "no hard-coded hex
 * anywhere" rule (CLAUDE.md principle 6) applies to generated values too,
 * not just hand-authored CSS, so there's nothing for scripts/check-no-
 * hex.mjs to special-case. */
function toCss(s: Swatch): string {
  return formatCss(clampChroma({ mode: 'oklch', l: s.l, c: s.c, h: s.h }, 'oklch'))
}

const MAX_CORRECTION_STEPS = 100
const STEP = 0.01

/** Nudges `fg`'s lightness toward the accessible extreme for `bg`'s mode
 * (darker in light mode, lighter in dark mode) until the pair passes
 * `threshold`, or gives up after MAX_CORRECTION_STEPS (which would only
 * happen if `threshold` itself were unreachable, e.g. > 21). */
function correctForeground(fg: Swatch, bg: Swatch, threshold: number, isLightMode: boolean, label: string, adjustments: string[]): void {
  let steps = 0
  while (contrastRatio(toCss(fg), toCss(bg)) < threshold && steps < MAX_CORRECTION_STEPS) {
    fg.l = isLightMode ? Math.max(0, fg.l - STEP) : Math.min(1, fg.l + STEP)
    steps += 1
  }
  if (steps > 0) adjustments.push(`${label}: nudged lightness ${steps} step(s) to reach ${threshold}:1`)
}

function deriveMode(hue: number, chroma: number, mode: 'light' | 'dark', adjustments: string[]): ThemeTokens {
  const isLight = mode === 'light'
  const tintC = Math.min(chroma, 0.02) // neutrals borrow a faint tint of the accent hue, never the full saturation

  const bg: Swatch = { l: isLight ? 0.99 : 0.17, c: tintC * 0.5, h: hue }
  const surface: Swatch = { l: isLight ? 0.97 : 0.22, c: tintC * 0.6, h: hue }
  const border: Swatch = { l: isLight ? 0.82 : 0.34, c: tintC, h: hue }
  const fg: Swatch = { l: isLight ? 0.18 : 0.95, c: tintC, h: hue }
  const fgMuted: Swatch = { l: isLight ? 0.42 : 0.7, c: tintC, h: hue }
  // Accent lightness anchors differ by mode: a light-mode "solid" accent
  // sits lower than dark-mode's, or it wouldn't read as vivid against a
  // light background (empirically-anchored, like Radix Colors/Tailwind's
  // own default palettes, not purely formula-derived — pure math without
  // anchors tends to produce muddy mid-tones).
  const accent: Swatch = { l: isLight ? 0.55 : 0.72, c: chroma, h: hue }
  const accentHover: Swatch = { l: isLight ? accent.l - 0.07 : accent.l + 0.07, c: chroma, h: hue }
  const accentSubtle: Swatch = { l: isLight ? 0.94 : 0.28, c: Math.min(chroma, 0.06), h: hue }

  correctForeground(fg, bg, AA_NORMAL_TEXT, isLight, `${mode} body text`, adjustments)
  correctForeground(fgMuted, bg, AA_NORMAL_TEXT, isLight, `${mode} muted text`, adjustments)
  correctForeground(border, bg, AA_UI_COMPONENT, isLight, `${mode} border`, adjustments)

  // accent-fg: whichever of near-white/near-black passes better against
  // the (not-yet-finalised) accent solid.
  const white: Swatch = { l: 0.98, c: 0, h: hue }
  const black: Swatch = { l: 0.15, c: 0, h: hue }
  const whiteWins = contrastRatio(toCss(white), toCss(accent)) >= contrastRatio(toCss(black), toCss(accent))
  const accentFg: Swatch = whiteWins ? { ...white } : { ...black }

  // If even the better choice of the two extremes still fails (only
  // possible for an accent hue sitting in the low-contrast middle of the
  // lightness range against BOTH extremes), push the accent's own
  // lightness toward whichever extreme accentFg represents, widening the
  // gap, rather than giving up.
  let steps = 0
  while (contrastRatio(toCss(accentFg), toCss(accent)) < AA_NORMAL_TEXT && steps < MAX_CORRECTION_STEPS) {
    accent.l = whiteWins ? Math.max(0, accent.l - STEP) : Math.min(1, accent.l + STEP)
    steps += 1
  }
  if (steps > 0) adjustments.push(`${mode} accent: nudged lightness ${steps} step(s) so its label text stays readable`)

  return {
    bg: toCss(bg),
    surface: toCss(surface),
    border: toCss(border),
    fg: toCss(fg),
    fgMuted: toCss(fgMuted),
    accent: toCss(accent),
    accentHover: toCss(accentHover),
    accentSubtle: toCss(accentSubtle),
    accentFg: toCss(accentFg),
  }
}

function isPaletteAccessible(tokens: ThemeTokens): boolean {
  return (
    contrastRatio(tokens.fg, tokens.bg) >= AA_NORMAL_TEXT &&
    contrastRatio(tokens.fgMuted, tokens.bg) >= AA_NORMAL_TEXT &&
    contrastRatio(tokens.accentFg, tokens.accent) >= AA_NORMAL_TEXT &&
    contrastRatio(tokens.border, tokens.bg) >= AA_UI_COMPONENT
  )
}

/**
 * Derives light AND dark token sets from one base color (both are always
 * generated — mode and accent are independent axes, docs/DECISIONS.md
 * "Theme token architecture"). `ok: false` means the editor should refuse
 * to save this theme ("reject a theme that fails contrast rather than
 * shipping it") — reachable only if MAX_CORRECTION_STEPS is exhausted,
 * which does not happen for any input this function has been exercised
 * against (see palette.test.ts, including deliberately extreme hues).
 */
export function deriveTheme(baseColor: string): DerivedTheme {
  const base = oklch(baseColor)
  if (!base) {
    return { light: EMPTY_TOKENS, dark: EMPTY_TOKENS, adjustments: [], ok: false }
  }
  const hue = base.h ?? 0
  const chroma = Math.max(base.c, 0.05) // a near-gray pick still gets a usable, visibly-tinted accent

  const adjustments: string[] = []
  const light = deriveMode(hue, chroma, 'light', adjustments)
  const dark = deriveMode(hue, chroma, 'dark', adjustments)

  return { light, dark, adjustments, ok: isPaletteAccessible(light) && isPaletteAccessible(dark) }
}

const EMPTY_TOKENS: ThemeTokens = {
  bg: '',
  surface: '',
  border: '',
  fg: '',
  fgMuted: '',
  accent: '',
  accentHover: '',
  accentSubtle: '',
  accentFg: '',
}
