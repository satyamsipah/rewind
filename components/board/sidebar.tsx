'use client'

import { Command, History, LogOut, Palette, Plus, Search } from 'lucide-react'
import { signOut, useSession } from 'next-auth/react'
import { useEffect, useRef } from 'react'
import { useLists } from '@/lib/client/hooks'
import { createList } from '@/lib/client/mutations'
import { positionsAppending } from '@/lib/shared/fractional-index'
import { useUiStore, type ViewFilter } from '@/lib/client/ui-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SyncStatusBadge } from '@/components/sync-status-badge'

const FILTERS: { value: ViewFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'completed', label: 'Completed' },
]

export function Sidebar() {
  const lists = useLists()
  const { data: session } = useSession()
  const activeListId = useUiStore((s) => s.activeListId)
  const setActiveListId = useUiStore((s) => s.setActiveListId)
  const filter = useUiStore((s) => s.filter)
  const setFilter = useUiStore((s) => s.setFilter)
  const searchQuery = useUiStore((s) => s.searchQuery)
  const setSearchQuery = useUiStore((s) => s.setSearchQuery)
  const focusSearchRequestId = useUiStore((s) => s.focusSearchRequestId)
  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen)
  const setHistoryOpen = useUiStore((s) => s.setHistoryOpen)
  const setThemeEditorOpen = useUiStore((s) => s.setThemeEditorOpen)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focusSearchRequestId > 0) searchRef.current?.focus()
  }, [focusSearchRequestId])

  async function handleNewList() {
    const name = window.prompt('List name')
    if (!name) return
    const [position] = positionsAppending(1, lists?.at(-1)?.position ?? null)
    await createList(name, position!)
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col gap-4 border-r border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Rewind</h1>
        <SyncStatusBadge />
      </div>

      <Button variant="outline" size="sm" className="justify-start gap-2" onClick={() => setCommandPaletteOpen(true)}>
        <Command className="h-4 w-4" /> Search & commands
        <kbd className="ml-auto rounded border border-border px-1 text-xs text-muted-foreground">⌘K</kbd>
      </Button>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          ref={searchRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search tasks…"
          className="pl-8"
          aria-label="Search tasks"
        />
      </div>

      <nav aria-label="Filters" className="flex flex-col gap-0.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            aria-current={filter === f.value ? 'page' : undefined}
            className={`rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
              filter === f.value ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </nav>

      <div className="flex items-center justify-between px-2 pt-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Lists</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleNewList} aria-label="New list">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <nav aria-label="Lists" className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        <button
          onClick={() => setActiveListId(null)}
          aria-current={activeListId === null ? 'page' : undefined}
          className={`rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
            activeListId === null ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          All tasks
        </button>
        {(lists ?? []).map((list) => (
          <button
            key={list.id}
            onClick={() => setActiveListId(list.id)}
            aria-current={activeListId === list.id ? 'page' : undefined}
            className={`truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
              activeListId === list.id ? 'bg-accent text-accent-foreground' : 'text-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {list.name}
          </button>
        ))}
        {lists && lists.length === 0 && <p className="px-2 py-4 text-sm text-muted-foreground">No lists yet.</p>}
      </nav>

      <div className="flex flex-col gap-1 border-t border-border pt-3">
        <Button variant="ghost" size="sm" className="justify-start gap-2" onClick={() => setHistoryOpen(true)}>
          <History className="h-4 w-4" /> History
          <kbd className="ml-auto rounded border border-border px-1 text-xs text-muted-foreground">⌘H</kbd>
        </Button>
        <Button variant="ghost" size="sm" className="justify-start gap-2" onClick={() => setThemeEditorOpen(true)}>
          <Palette className="h-4 w-4" /> Theme
        </Button>
        {session?.user && (
          <Button variant="ghost" size="sm" className="justify-start gap-2" onClick={() => signOut()}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        )}
      </div>
    </aside>
  )
}
