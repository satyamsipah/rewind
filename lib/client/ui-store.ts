import { create } from 'zustand'

/**
 * Ephemeral, per-tab UI state — never persisted, never synced. Anything
 * that IS persisted (theme preference, task data) flows through Dexie +
 * events instead (lib/client/db.ts, lib/client/mutations.ts) and is read
 * reactively via dexie-react-hooks, not kept here — this is CLAUDE.md's
 * "Zustand for client state" applied specifically to state that has no
 * business surviving a reload.
 */
export type ViewFilter = 'all' | 'today' | 'upcoming' | 'completed'

interface UiState {
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean) => void

  shortcutSheetOpen: boolean
  setShortcutSheetOpen: (open: boolean) => void

  activeListId: string | null
  setActiveListId: (id: string | null) => void

  filter: ViewFilter
  setFilter: (filter: ViewFilter) => void

  searchQuery: string
  setSearchQuery: (query: string) => void

  historyOpen: boolean
  setHistoryOpen: (open: boolean) => void

  /** null = the activity timeline; a task id = that task's own history. */
  historyTaskId: string | null
  setHistoryTaskId: (id: string | null) => void

  timeTravelAt: string | null
  setTimeTravelAt: (iso: string | null) => void

  themeEditorOpen: boolean
  setThemeEditorOpen: (open: boolean) => void

  /** Bumped by the global 'n' / '/' shortcuts (lib/client/shortcuts.ts);
   * the currently-visible board page watches these rather than the
   * global listener needing a direct DOM ref into page-specific
   * components. */
  newTaskRequestId: number
  requestNewTask: () => void
  focusSearchRequestId: number
  requestFocusSearch: () => void
}

export const useUiStore = create<UiState>((set) => ({
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  shortcutSheetOpen: false,
  setShortcutSheetOpen: (open) => set({ shortcutSheetOpen: open }),

  activeListId: null,
  setActiveListId: (id) => set({ activeListId: id }),

  filter: 'all',
  setFilter: (filter) => set({ filter }),

  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query }),

  historyOpen: false,
  setHistoryOpen: (open) => set({ historyOpen: open }),

  historyTaskId: null,
  setHistoryTaskId: (id) => set({ historyTaskId: id }),

  timeTravelAt: null,
  setTimeTravelAt: (iso) => set({ timeTravelAt: iso }),

  themeEditorOpen: false,
  setThemeEditorOpen: (open) => set({ themeEditorOpen: open }),

  newTaskRequestId: 0,
  requestNewTask: () => set((s) => ({ newTaskRequestId: s.newTaskRequestId + 1 })),
  focusSearchRequestId: 0,
  requestFocusSearch: () => set((s) => ({ focusSearchRequestId: s.focusSearchRequestId + 1 })),
}))
