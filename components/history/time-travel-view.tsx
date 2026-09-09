'use client'

import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import type { AppState } from '@/lib/domain/state'
import { getStateAt } from '@/lib/client/history'
import { Button } from '@/components/ui/button'

/** Item 4: "a date/time picker that renders the whole board as it was at
 * that instant, clearly marked read-only". No mutation call anywhere in
 * this component — it only reads, via lib/client/history.ts getStateAt. */
export function TimeTravelView() {
  const [at, setAt] = useState(() => new Date().toISOString().slice(0, 16))
  const [state, setState] = useState<AppState | null>(null)
  const [loading, setLoading] = useState(false)

  async function apply() {
    setLoading(true)
    const iso = new Date(at).toISOString()
    setState(await getStateAt(iso))
    setLoading(false)
  }

  // Runs once on mount, defaulting the view to "now" — `apply` closes
  // over `at`/`setState`/`setLoading` but is only ever (re)called from
  // the button's own onClick after this, so re-running it here on every
  // `at` change would fight the user typing into the picker.
  useEffect(() => {
    apply()
  }, [])

  const lists = state ? Object.values(state.lists).filter((l) => !l.archived) : []
  const tasks = state ? Object.values(state.tasks).filter((t) => !t.deleted) : []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <input
          type="datetime-local"
          value={at}
          onChange={(e) => setAt(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
        />
        <Button size="sm" onClick={apply} disabled={loading}>
          {loading ? 'Loading…' : 'View'}
        </Button>
      </div>

      <div className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
        <Lock className="h-3.5 w-3.5" /> Read-only — this is the board as it was, not the live board.
      </div>

      <div className="flex flex-col gap-4">
        {lists.map((list) => {
          const listTasks = tasks.filter((t) => t.list_id === list.id && !t.parent_task_id)
          return (
            <div key={list.id}>
              <h4 className="mb-1 text-sm font-medium text-foreground">{list.name}</h4>
              <ul className="flex flex-col gap-1">
                {listTasks.map((t) => (
                  <li key={t.id} className={`text-sm ${t.completed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                    {t.title}
                  </li>
                ))}
                {listTasks.length === 0 && <li className="text-xs text-muted-foreground">No tasks yet at this instant.</li>}
              </ul>
            </div>
          )
        })}
        {lists.length === 0 && <p className="text-sm text-muted-foreground">Nothing existed yet at this instant.</p>}
      </div>
    </div>
  )
}
