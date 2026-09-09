'use client'

import { SHORTCUTS } from '@/lib/client/shortcuts'
import { useUiStore } from '@/lib/client/ui-store'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

/** The "discoverable shortcut sheet" item 6 asks for — opened with `?`,
 * and lists the exact same table lib/client/shortcuts.ts's handler
 * implements, so it can never drift out of sync with what actually
 * works. */
export function ShortcutSheet() {
  const open = useUiStore((s) => s.shortcutSheetOpen)
  const setOpen = useUiStore((s) => s.setShortcutSheetOpen)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>Every primary action in Rewind has a shortcut.</DialogDescription>
        <ul className="mt-4 space-y-2">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between text-sm">
              <span className="text-foreground">{s.description}</span>
              <kbd className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
