import type { TaskState } from '@/lib/domain/state'
import type { ViewFilter } from './ui-store'

/**
 * Filtering and full-text search over the local projection (item 3) —
 * pure and synchronous, so it's instant and needs no network regardless
 * of how large the local task list gets. Kept out of components per
 * CLAUDE.md "No business logic in components".
 */
export function applyViewFilter(tasks: TaskState[], filter: ViewFilter, now: Date = new Date()): TaskState[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday)
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1)

  switch (filter) {
    case 'completed':
      return tasks.filter((t) => t.completed && !t.deleted)
    case 'today':
      return tasks.filter((t) => {
        if (t.deleted || t.completed || !t.due_date) return false
        const due = new Date(t.due_date)
        return due >= startOfToday && due < startOfTomorrow
      })
    case 'upcoming':
      return tasks.filter((t) => {
        if (t.deleted || t.completed || !t.due_date) return false
        return new Date(t.due_date) >= startOfTomorrow
      })
    case 'all':
    default:
      return tasks.filter((t) => !t.deleted)
  }
}

export function searchTasks(tasks: TaskState[], query: string): TaskState[] {
  const q = query.trim().toLowerCase()
  if (!q) return tasks
  return tasks.filter((t) => t.title.toLowerCase().includes(q) || t.tags.some((tag) => tag.toLowerCase().includes(q)) || t.note?.toLowerCase().includes(q))
}
