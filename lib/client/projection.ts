import type { EntityType } from '@/lib/events/envelope'
import { reduce } from '@/lib/domain/reducer'
import { db } from './db'

/**
 * Rebuilds ONE entity's local projection row by replaying its full event
 * slice through `reduce()` — the exact same "full per-entity replay,
 * never an incremental patch" strategy lib/db/projections.ts uses
 * server-side (docs/DECISIONS.md), so client and server can never
 * disagree about how a task/list looks once both have the same events.
 *
 * Called after every local mutation (optimistic write) and after every
 * remote event application (sync pull) — see lib/client/mutations.ts and
 * lib/client/sync-adapter.ts.
 */
export async function rebuildLocalProjection(entityId: string, entityType: EntityType): Promise<void> {
  if (entityType === 'user') {
    await rebuildPreferences()
    return
  }

  const events = await db.events.where('entity_id').equals(entityId).toArray()
  if (events.length === 0) {
    if (entityType === 'task') await db.tasks.delete(entityId)
    else await db.lists.delete(entityId)
    return
  }

  const state = reduce(events)
  if (entityType === 'task') {
    const task = state.tasks[entityId]
    if (task) await db.tasks.put(task)
  } else {
    const list = state.lists[entityId]
    if (list) await db.lists.put(list)
  }
}

/**
 * Preferences aren't nested by entity id (lib/domain/state.ts
 * `Preferences`), so unlike a task/list they're rebuilt from every local
 * `user`-type event rather than one entity's slice — cheap, since a
 * user's own preference history is tiny.
 */
async function rebuildPreferences(): Promise<void> {
  const events = await db.events.where('entity_type').equals('user').toArray()
  const state = reduce(events)
  await db.preferences.clear()
  const rows = Object.entries(state.preferences).map(([key, value]) => ({ key, value: value ?? null }))
  if (rows.length > 0) await db.preferences.bulkPut(rows)
}
