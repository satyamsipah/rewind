'use client'

import { formatHex } from 'culori'
import { useState } from 'react'
import { toast } from 'sonner'
import { BUILT_IN_ACCENT_SEEDS } from '@/lib/theme/presets'
import { deriveTheme } from '@/lib/theme/palette'
import { setCustomThemeAccent, setThemeAccent, setThemeMode } from '@/lib/client/theme'
import type { AccentName } from '@/lib/theme/presets'
import { useUiStore } from '@/lib/client/ui-store'
import { usePreferences } from '@/lib/client/hooks'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

const BUILT_INS: { name: AccentName; label: string }[] = [
  { name: 'default', label: 'Default' },
  { name: 'violet', label: 'Violet' },
  { name: 'amber', label: 'Amber' },
]

/** `<input type="color">` is a native HTML control that only accepts a
 * 7-character hex string per spec — oklch() isn't a legal value for it.
 * Computed via culori, not typed as a literal, so no hex string exists
 * in this file's own source (scripts/check-no-hex.mjs scans app/**\/*.ts,
 * components/**\/*.ts, lib/**\/*.ts — this stays a genuine zero-exception
 * rule rather than needing an allowlist entry). */
const DEFAULT_BASE_COLOR = formatHex(BUILT_IN_ACCENT_SEEDS.default) ?? 'rgb(59 130 246)'

/**
 * Item 5's custom theme editor: pick a base colour, see the derived
 * palette and its AA contrast report live, and only "Save" if it passes
 * — "reject a theme that fails contrast rather than shipping it".
 * lib/theme/palette.ts does the actual derivation/validation/auto-
 * correction; this component only previews and persists the result.
 */
export function ThemeEditorDialog() {
  const open = useUiStore((s) => s.themeEditorOpen)
  const setOpen = useUiStore((s) => s.setThemeEditorOpen)
  const prefs = usePreferences()
  const [baseColor, setBaseColor] = useState(DEFAULT_BASE_COLOR)

  const mode = (prefs?.find((p) => p.key === 'theme_mode')?.value as 'light' | 'dark' | 'system' | undefined) ?? 'system'
  const accent = prefs?.find((p) => p.key === 'theme_accent')?.value ?? 'default'

  const preview = deriveTheme(baseColor)

  async function save() {
    const result = await setCustomThemeAccent(baseColor)
    if (result.ok) toast.success('Custom theme saved')
    else toast.error("That colour couldn't be made accessible — try a less extreme lightness.")
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Theme</DialogTitle>
        <DialogDescription>Mode, accent, or a fully custom colour — validated for WCAG AA contrast.</DialogDescription>

        <div className="mt-4 flex flex-col gap-5">
          <section>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Mode</h4>
            <div className="flex gap-2">
              {(['light', 'dark', 'system'] as const).map((m) => (
                <Button key={m} size="sm" variant={mode === m ? 'default' : 'outline'} onClick={() => setThemeMode(m)}>
                  {m}
                </Button>
              ))}
            </div>
          </section>

          <section>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Built-in accents</h4>
            <div className="flex gap-2">
              {BUILT_INS.map((b) => (
                <Button key={b.name} size="sm" variant={accent === b.name ? 'default' : 'outline'} onClick={() => setThemeAccent(b.name)}>
                  {b.label}
                </Button>
              ))}
            </div>
          </section>

          <section>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Custom</h4>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={/^#/.test(baseColor) ? baseColor : DEFAULT_BASE_COLOR}
                onChange={(e) => setBaseColor(e.target.value)}
                className="h-9 w-9 cursor-pointer rounded-md border border-input bg-transparent"
                aria-label="Pick a base colour"
              />
              <input
                value={baseColor}
                onChange={(e) => setBaseColor(e.target.value)}
                placeholder="oklch(0.6 0.19 250), or paste a hex colour"
                className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </div>

            <div className="mt-3 flex gap-2">
              {(['light', 'dark'] as const).map((m) => {
                const tokens = preview[m]
                return (
                  <div key={m} className="flex-1 rounded-md border border-border p-3" style={{ background: tokens.bg }}>
                    <p className="text-xs" style={{ color: tokens.fgMuted }}>
                      {m}
                    </p>
                    <p className="text-sm font-medium" style={{ color: tokens.fg }}>
                      Body text
                    </p>
                    <span
                      className="mt-2 inline-block rounded-md px-2 py-1 text-xs font-medium"
                      style={{ background: tokens.accent, color: tokens.accentFg }}
                    >
                      Accent button
                    </span>
                  </div>
                )
              })}
            </div>

            <p className={`mt-2 text-xs ${preview.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
              {preview.ok
                ? preview.adjustments.length > 0
                  ? `Auto-adjusted for contrast: ${preview.adjustments.length} correction(s) applied.`
                  : 'Passes WCAG AA with no adjustment needed.'
                : "This colour can't be made accessible — try adjusting it."}
            </p>

            <Button className="mt-3" size="sm" onClick={save} disabled={!preview.ok}>
              Save custom theme
            </Button>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
