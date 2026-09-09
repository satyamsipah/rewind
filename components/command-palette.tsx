'use client'

import { Command } from 'cmdk'
import { CalendarClock, History, ListPlus, Moon, Palette, Plus, Sun, SunMoon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useLists } from '@/lib/client/hooks'
import { createList } from '@/lib/client/mutations'
import { setThemeAccent, setThemeMode } from '@/lib/client/theme'
import { useUiStore } from '@/lib/client/ui-store'
import { positionBetween } from '@/lib/shared/fractional-index'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

/**
 * Cmd+K (item 6): create, search, navigate, switch theme, jump to
 * history. `cmdk` does the fuzzy filtering; this just supplies the
 * commands and wires them to the same lib/client/mutations.ts and
 * lib/client/theme.ts functions every other UI surface calls — no
 * parallel "palette-only" way of doing any of these things.
 */
export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen)
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen)
  const requestNewTask = useUiStore((s) => s.requestNewTask)
  const setActiveListId = useUiStore((s) => s.setActiveListId)
  const setHistoryOpen = useUiStore((s) => s.setHistoryOpen)
  const setThemeEditorOpen = useUiStore((s) => s.setThemeEditorOpen)
  const lists = useLists()
  const router = useRouter()
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  function runThenClose(fn: () => void) {
    fn()
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md overflow-hidden p-0" aria-describedby={undefined}>
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command shouldFilter className="flex flex-col">
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Type a command or search…"
            className="border-b border-border bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-2 py-6 text-center text-sm text-muted-foreground">No results.</Command.Empty>

            <Command.Group heading="Create" className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
              <PaletteItem icon={<Plus className="h-4 w-4" />} onSelect={() => runThenClose(requestNewTask)}>
                New task
              </PaletteItem>
              <PaletteItem
                icon={<ListPlus className="h-4 w-4" />}
                onSelect={() =>
                  runThenClose(async () => {
                    const name = window.prompt('List name')
                    if (name) await createList(name, positionBetween(null, null))
                  })
                }
              >
                New list
              </PaletteItem>
            </Command.Group>

            <Command.Group heading="Go to" className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
              {(lists ?? []).map((list) => (
                <PaletteItem key={list.id} onSelect={() => runThenClose(() => setActiveListId(list.id))}>
                  {list.name}
                </PaletteItem>
              ))}
              <PaletteItem icon={<History className="h-4 w-4" />} onSelect={() => runThenClose(() => setHistoryOpen(true))}>
                Activity history
              </PaletteItem>
              <PaletteItem
                icon={<CalendarClock className="h-4 w-4" />}
                onSelect={() => runThenClose(() => router.push('/history?timeTravel=1'))}
              >
                Time travel
              </PaletteItem>
            </Command.Group>

            <Command.Group heading="Theme" className="text-xs text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5">
              <PaletteItem icon={<Sun className="h-4 w-4" />} onSelect={() => runThenClose(() => setThemeMode('light'))}>
                Light mode
              </PaletteItem>
              <PaletteItem icon={<Moon className="h-4 w-4" />} onSelect={() => runThenClose(() => setThemeMode('dark'))}>
                Dark mode
              </PaletteItem>
              <PaletteItem icon={<SunMoon className="h-4 w-4" />} onSelect={() => runThenClose(() => setThemeMode('system'))}>
                System theme
              </PaletteItem>
              <PaletteItem icon={<Palette className="h-4 w-4" />} onSelect={() => runThenClose(() => setThemeAccent('default'))}>
                Accent: Default
              </PaletteItem>
              <PaletteItem icon={<Palette className="h-4 w-4" />} onSelect={() => runThenClose(() => setThemeAccent('violet'))}>
                Accent: Violet
              </PaletteItem>
              <PaletteItem icon={<Palette className="h-4 w-4" />} onSelect={() => runThenClose(() => setThemeAccent('amber'))}>
                Accent: Amber
              </PaletteItem>
              <PaletteItem icon={<Palette className="h-4 w-4" />} onSelect={() => runThenClose(() => setThemeEditorOpen(true))}>
                Custom theme editor…
              </PaletteItem>
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function PaletteItem({ children, icon, onSelect }: { children: React.ReactNode; icon?: React.ReactNode; onSelect: () => void }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
    >
      {icon}
      {children}
    </Command.Item>
  )
}
