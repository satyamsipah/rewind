import type { PreferenceKey, Priority } from '@/lib/events/schemas'

/**
 * Projected (materialised) state. This is what `reduce()` (reducer.ts)
 * produces from an event array, and what `projections` (lib/db/schema.ts)
 * caches per-entity in Postgres. Field-level merge metadata lives
 * alongside each field so a display layer can explain "why did this win"
 * without re-deriving it from the raw event log.
 */

export interface TaskState {
  id: string
  list_id: string
  title: string
  position: string
  /** Parent task id for a subtask, null for a top-level task. Travels in
   * the same atomic move pair as list_id/position (lib/events/schemas.ts
   * TaskMoved) so a concurrent re-parent and a concurrent list-move can
   * never merge into a task with mismatched list/parent/position. */
  parent_task_id: string | null
  completed: boolean
  completed_at: string | null
  due_date: string | null
  priority: Priority | null
  note: string | null
  /** Sorted for deterministic canonical serialisation (canonical.ts). */
  tags: string[]
  /** Tombstone flag — TaskDeleted/TaskRestored. Append-only means this is
   * a soft delete; the row is never removed from state, only hidden by
   * `observable()`. */
  deleted: boolean
  created_at: string
}

export interface ListState {
  id: string
  name: string
  position: string
  archived: boolean
  created_at: string
}

/** Flat, not nested by entity id — there is conceptually one
 * preference-holder (the signed-in user) per local event log. Absent key
 * = never set = caller falls back to a built-in default. */
export type Preferences = Partial<Record<PreferenceKey, string | null>>

export interface AppState {
  tasks: Record<string, TaskState>
  lists: Record<string, ListState>
  preferences: Preferences
}

export function emptyState(): AppState {
  return { tasks: {}, lists: {}, preferences: {} }
}

/**
 * The default "active" view of state: deleted tasks and archived lists
 * hidden. Used both by the round-trip test (apply-then-inverse of
 * TaskCreated/ListCreated leaves a tombstone, not a true absence — see
 * reducer.test.ts) and, later, by API routes that want the everyday view
 * without a separate "trash"/"archive" query.
 */
export function observable(state: AppState): AppState {
  return {
    tasks: Object.fromEntries(Object.entries(state.tasks).filter(([, t]) => !t.deleted)),
    lists: Object.fromEntries(Object.entries(state.lists).filter(([, l]) => !l.archived)),
    preferences: state.preferences,
  }
}
