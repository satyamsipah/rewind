import { deriveTheme, type ThemeTokens } from './palette'
import { accentTokens, type AccentName } from './presets'

/**
 * Applies an accent (built-in or custom) by writing eight raw CSS custom
 * properties onto `:root` via inline style — `--accent-light-*` and
 * `--accent-dark-*`. app/globals.css aliases the public `--primary`/
 * `--primary-foreground`/etc. tokens to whichever half matches the
 * current `data-theme`/`prefers-color-scheme`.
 *
 * This split matters: light/dark MODE switching (system preference
 * changing, or the user toggling it) must be instant and JS-free — it's
 * just a `data-theme` attribute flip that CSS reacts to. Only ACCENT
 * changes (a rare, deliberate user action) need this JS to run. If accent
 * application also had to re-run on every mode change, a system dark-
 * mode switch firing while this tab is backgrounded (no JS execution
 * guaranteed) could leave the accent stale until next repaint.
 */
const RAW_VARS: (keyof AccentRaw)[] = [
  'accentLight',
  'accentHoverLight',
  'accentSubtleLight',
  'accentFgLight',
  'accentDark',
  'accentHoverDark',
  'accentSubtleDark',
  'accentFgDark',
]

interface AccentRaw {
  accentLight: string
  accentHoverLight: string
  accentSubtleLight: string
  accentFgLight: string
  accentDark: string
  accentHoverDark: string
  accentSubtleDark: string
  accentFgDark: string
}

const CSS_VAR_NAME: Record<keyof AccentRaw, string> = {
  accentLight: '--accent-light',
  accentHoverLight: '--accent-hover-light',
  accentSubtleLight: '--accent-subtle-light',
  accentFgLight: '--accent-fg-light',
  accentDark: '--accent-dark',
  accentHoverDark: '--accent-hover-dark',
  accentSubtleDark: '--accent-subtle-dark',
  accentFgDark: '--accent-fg-dark',
}

function toRaw(light: ThemeTokens | ReturnType<typeof accentTokens>['light'], dark: typeof light): AccentRaw {
  return {
    accentLight: light.accent,
    accentHoverLight: light.accentHover,
    accentSubtleLight: light.accentSubtle,
    accentFgLight: light.accentFg,
    accentDark: dark.accent,
    accentHoverDark: dark.accentHover,
    accentSubtleDark: dark.accentSubtle,
    accentFgDark: dark.accentFg,
  }
}

function writeRawVars(raw: AccentRaw): void {
  const root = document.documentElement
  for (const key of RAW_VARS) {
    root.style.setProperty(CSS_VAR_NAME[key], raw[key])
  }
}

export function applyBuiltInAccent(name: AccentName): void {
  const { light, dark } = accentTokens(name)
  writeRawVars(toRaw(light, dark))
}

/** Returns the derivation report so the caller (the theme editor) can
 * decide whether to apply it — see docs/DECISIONS.md "reject a theme
 * that fails contrast rather than shipping it". */
export function applyCustomAccent(baseColor: string): ReturnType<typeof deriveTheme> {
  const result = deriveTheme(baseColor)
  if (result.ok) writeRawVars(toRaw(result.light, result.dark))
  return result
}

export type ThemeMode = 'light' | 'dark' | 'system'

/** `data-theme` unset means "system" — app/globals.css's
 * `prefers-color-scheme` media queries take over. Explicit light/dark
 * sets the attribute so it wins over the OS preference. */
export function applyMode(mode: ThemeMode): void {
  const root = document.documentElement
  if (mode === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', mode)
}

export function resolvedMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
