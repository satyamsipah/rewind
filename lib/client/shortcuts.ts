'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'
import { useUiStore } from './ui-store'
import { redo, undo } from './undo'

/**
 * Item 6: "Fully keyboard-navigable app — every primary action has a
 * shortcut, with a discoverable shortcut sheet." One global listener
 * (mounted once in components/providers/providers.tsx) rather than each
 * component registering its own — avoids N components fighting over the
 * same keys and makes the full list in components/shortcut-sheet.tsx
 * trivially exhaustive (it's the same table this hook reads).
 */
export interface Shortcut {
  keys: string
  description: string
  isMod?: boolean
}

export const SHORTCUTS: Shortcut[] = [
  { keys: 'Cmd/Ctrl+K', description: 'Open command palette' },
  { keys: 'Cmd/Ctrl+Z', description: 'Undo' },
  { keys: 'Cmd/Ctrl+Shift+Z', description: 'Redo' },
  { keys: 'N', description: 'New task' },
  { keys: '/', description: 'Focus search' },
  { keys: 'Cmd/Ctrl+H', description: 'Open activity history' },
  { keys: '?', description: 'Show this shortcut sheet' },
  { keys: 'Escape', description: 'Close the open panel' },
]

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

export function useKeyboardShortcuts(): void {
  const store = useUiStore()

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        store.setCommandPaletteOpen(!store.commandPaletteOpen)
        return
      }

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) {
          redo().then((r) => r && toast(`Redid: ${r.event.type}`))
        } else {
          undo().then((r) => r && toast(`Undid: ${r.event.type}`))
        }
        return
      }

      if (mod && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        store.setHistoryTaskId(null)
        store.setHistoryOpen(!store.historyOpen)
        return
      }

      // Everything below is a bare-key shortcut — never fire while the
      // user is typing in a field.
      if (isTypingTarget(e.target)) return

      if (e.key === '?') {
        e.preventDefault()
        store.setShortcutSheetOpen(!store.shortcutSheetOpen)
        return
      }
      if (e.key === 'Escape') {
        store.setCommandPaletteOpen(false)
        store.setShortcutSheetOpen(false)
        store.setHistoryOpen(false)
        store.setThemeEditorOpen(false)
        return
      }
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        store.requestNewTask()
        return
      }
      if (e.key === '/') {
        e.preventDefault()
        store.requestFocusSearch()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [store])
}
