'use client'

import { useEffect } from 'react'
import { applyBuiltInAccent, applyCustomAccent, applyMode, type ThemeMode } from '@/lib/theme/apply'
import type { AccentName } from '@/lib/theme/presets'
import {
  THEME_ACCENT_CACHE_KEY,
  THEME_ACCENT_VARS_CACHE_KEY,
  THEME_CUSTOM_CACHE_KEY,
  THEME_MODE_CACHE_KEY,
} from '@/lib/theme/storage-keys'
import { usePreferences } from './hooks'
import { setPreference } from './mutations'

const BUILT_IN_ACCENTS = new Set<AccentName>(['default', 'violet', 'amber'])

/**
 * Theme persists locally (Dexie, via PreferenceSet events — item 5) and
 * this hook is what actually APPLIES it: every render where the stored
 * preferences change, it re-derives and re-writes the CSS custom
 * properties (lib/theme/apply.ts) and refreshes the FOUC-prevention
 * cache (lib/theme/storage-keys.ts) for next load — including the raw
 * computed --accent-* values themselves, so app/layout.tsx's
 * pre-hydration boot script can replay them with a plain setProperty
 * loop instead of duplicating the OKLCH derivation into an inline
 * script. Mounted once, high in the tree
 * (components/providers/providers.tsx).
 */
export function useThemeSync(): void {
  const prefs = usePreferences()

  useEffect(() => {
    if (!prefs) return
    const mode = (prefs.find((p) => p.key === 'theme_mode')?.value as ThemeMode | undefined) ?? 'system'
    const accent = prefs.find((p) => p.key === 'theme_accent')?.value ?? 'default'
    const custom = prefs.find((p) => p.key === 'theme_custom')?.value ?? null

    applyMode(mode)
    localStorage.setItem(THEME_MODE_CACHE_KEY, mode)

    if (accent === 'custom' && custom) {
      const result = applyCustomAccent(custom)
      localStorage.setItem(THEME_ACCENT_CACHE_KEY, 'custom')
      localStorage.setItem(THEME_CUSTOM_CACHE_KEY, custom)
      if (result.vars) localStorage.setItem(THEME_ACCENT_VARS_CACHE_KEY, JSON.stringify(result.vars))
    } else if (BUILT_IN_ACCENTS.has(accent as AccentName)) {
      const vars = applyBuiltInAccent(accent as AccentName)
      localStorage.setItem(THEME_ACCENT_CACHE_KEY, accent)
      localStorage.setItem(THEME_ACCENT_VARS_CACHE_KEY, JSON.stringify(vars))
    }
  }, [prefs])
}

export async function setThemeMode(mode: ThemeMode): Promise<void> {
  await setPreference('theme_mode', mode)
}

export async function setThemeAccent(name: AccentName): Promise<void> {
  await setPreference('theme_accent', name)
}

/** Only persists if the derived palette actually passes AA — "reject a
 * theme that fails contrast rather than shipping it" (item 5). Returns
 * the derivation report so the editor UI can show what happened. */
export async function setCustomThemeAccent(baseColor: string) {
  const result = applyCustomAccent(baseColor)
  if (result.ok) {
    await setPreference('theme_accent', 'custom')
    await setPreference('theme_custom', baseColor)
  }
  return result
}
