import { deriveTheme } from './palette'

/**
 * The three (well, four counting "default") built-in accents (item 5).
 * Each is just a seed hue run through the exact same `deriveTheme`
 * pipeline the custom theme editor uses — one code path for "given a
 * hue, produce a validated accent scale", not a separate hand-tuned set
 * of hex values that could silently drift out of AA compliance.
 *
 * Only the accent-related fields are taken from the result; the built-in
 * neutral scale (app/globals.css `:root`/`[data-theme="dark"]`) is fixed,
 * pure gray (zero chroma) rather than tinted — that tinting behaviour is
 * a custom-theme touch, not how the un-customised app should look.
 */
export const BUILT_IN_ACCENT_SEEDS = {
  default: 'oklch(0.6 0.19 250)', // blue
  violet: 'oklch(0.55 0.22 300)',
  amber: 'oklch(0.75 0.16 70)',
} as const

export type AccentName = keyof typeof BUILT_IN_ACCENT_SEEDS

export interface AccentTokens {
  accent: string
  accentHover: string
  accentSubtle: string
  accentFg: string
}

export function accentTokens(name: AccentName): { light: AccentTokens; dark: AccentTokens } {
  const { light, dark } = deriveTheme(BUILT_IN_ACCENT_SEEDS[name])
  const pick = ({ accent, accentHover, accentSubtle, accentFg }: typeof light): AccentTokens => ({
    accent,
    accentHover,
    accentSubtle,
    accentFg,
  })
  return { light: pick(light), dark: pick(dark) }
}
