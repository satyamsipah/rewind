/**
 * localStorage keys for the FOUC-prevention cache: a synchronous copy of
 * the current theme selection, written whenever it changes
 * (lib/client/theme.ts) and read back by the inline boot script in
 * app/layout.tsx BEFORE React hydrates or Dexie has had a chance to
 * resolve — Dexie is the durable source of truth (the PreferenceSet
 * events sync it across devices), this cache exists purely so the first
 * paint isn't the wrong theme for a split second.
 *
 * The literal strings are duplicated in app/layout.tsx's inline script
 * (which can't import a module) — keep them in sync if you change these.
 */
export const THEME_MODE_CACHE_KEY = 'rewind:cached-theme-mode'
export const THEME_ACCENT_CACHE_KEY = 'rewind:cached-theme-accent'
export const THEME_CUSTOM_CACHE_KEY = 'rewind:cached-theme-custom'
/** JSON map of the actual `--accent-*` CSS variable names to their last-
 * applied values (lib/theme/apply.ts `AccentCssVars`) — lets the boot
 * script replay them verbatim instead of re-running OKLCH derivation. */
export const THEME_ACCENT_VARS_CACHE_KEY = 'rewind:cached-theme-accent-vars'
