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

export interface AccentRaw {
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

/** The real `--accent-*` custom-property names, keyed by CSS var name —
 * this is the exact shape lib/client/theme.ts caches to localStorage so
 * app/layout.tsx's pre-hydration boot script can replay it with a plain
 * `setProperty` loop, no derivation logic duplicated into an inline
 * script. */
export type AccentCssVars = Record<string, string>

function toCssVarMap(raw: AccentRaw): AccentCssVars {
  const out: AccentCssVars = {}
  for (const key of RAW_VARS) out[CSS_VAR_NAME[key]] = raw[key]
  return out
}

export function applyAccentCssVars(vars: AccentCssVars): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
}

export function applyBuiltInAccent(name: AccentName): AccentCssVars {
  const { light, dark } = accentTokens(name)
  const vars = toCssVarMap(toRaw(light, dark))
  applyAccentCssVars(vars)
  return vars
}

/** Returns the derivation report so the caller (the theme editor) can
 * decide whether to apply it — see docs/DECISIONS.md "reject a theme
 * that fails contrast rather than shipping it". */
export function applyCustomAccent(baseColor: string): ReturnType<typeof deriveTheme> & { vars: AccentCssVars | null } {
  const result = deriveTheme(baseColor)
  if (!result.ok) return { ...result, vars: null }
  const vars = toCssVarMap(toRaw(result.light, result.dark))
  applyAccentCssVars(vars)
  return { ...result, vars }
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
