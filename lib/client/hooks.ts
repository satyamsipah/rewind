'use client'

import { useLiveQuery } from 'dexie-react-hooks'
import { useSyncExternalStore } from 'react'
import { db } from './db'
import type { TaskState } from '@/lib/domain/state'
import { getSyncStatus, subscribeSyncStatus, type SyncEvent, type SyncStatus } from './sync-engine'
import { canRedo, canUndo } from './undo'

/**
 * Reactive reads over the local projection — instant, no network, live-
 * updating on every local write or synced remote change (item 1/3:
 * "Reads come from the local projection... instant, no network"). Dexie's
 * own live-query hook, not TanStack Query: the data source here is the
 * IndexedDB projection itself, not a remote fetch to cache — TanStack
 * Query stays reserved for genuinely server-fetched state (the auth
 * session), which is the CLAUDE.md-pinned split this project actually
 * has two different kinds of "state" for.
 */

export function useLists() {
  return useLiveQuery(() => db.lists.orderBy('position').toArray(), [], [])
}

export function useTasksForList(listId: string | null) {
  return useLiveQuery(
    () => (listId ? db.tasks.where('list_id').equals(listId).sortBy('position') : Promise.resolve<TaskState[]>([])),
    [listId],
    [],
  )
}

export function useAllTasks() {
  return useLiveQuery(() => db.tasks.toArray(), [], [])
}

export function useSubtasks(parentTaskId: string) {
  return useLiveQuery(() => db.tasks.where('parent_task_id').equals(parentTaskId).sortBy('position'), [parentTaskId], [])
}

export function usePreferences() {
  return useLiveQuery(() => db.preferences.toArray(), [], [])
}

export function useOutboxCount() {
  return useLiveQuery(() => db.outbox.count(), [], 0)
}

export function useUndoAvailability() {
  return useLiveQuery(async () => ({ canUndo: await canUndo(), canRedo: await canRedo() }), [], {
    canUndo: false,
    canRedo: false,
  })
}

/** The visible sync status indicator (item 2: "synced / syncing /
 * offline / conflict"). useSyncExternalStore rather than useState+useEffect
 * so this is safe to read during SSR (returns the server snapshot) and
 * never tears between renders. */
let lastEvent: SyncEvent = { status: getSyncStatus() }

export function useSyncStatus(): SyncEvent {
  return useSyncExternalStore(
    (onStoreChange) =>
      subscribeSyncStatus((event) => {
        lastEvent = event
        onStoreChange()
      }),
    () => lastEvent,
    () => ({ status: 'offline' as SyncStatus }),
  )
}
