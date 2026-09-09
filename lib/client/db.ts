import Dexie, { type EntityTable } from 'dexie'
import type { VectorClock } from '@/lib/events/envelope'
import type { AnyEvent } from '@/lib/events/schemas'
import type { ListState, TaskState } from '@/lib/domain/state'

/**
 * The local event log, mirroring the server's `events` table
 * (lib/db/schema.ts) — the source of truth this whole client is built
 * on. Reads for the UI never come from this table directly (that's what
 * `tasks`/`lists`/`preferences` are for); it exists so History, per-task
 * lifecycle, time travel, and undo/redo all work fully offline, which
 * they couldn't if the client only kept a projection.
 */
export interface OutboxRow {
  /** Same id as the event in `events` — a queue of "not yet
   * server-confirmed", not a copy of the event itself. */
  id: string
  createdAt: number
}

export interface SyncMetaRow {
  id: 'singleton'
  deviceId: string
  sinceSeq: number
  clock: VectorClock
}

/** Mirrors the server's undo_entries 3-state machine (lib/db/undo.ts),
 * but is authoritative HERE, not on the server — see docs/DECISIONS.md
 * "Undo/redo — client-owned for offline support". */
export interface UndoEntryRow {
  id?: number
  eventId: string
  compensatingEventId: string | null
  state: 'active' | 'undone' | 'superseded'
  createdAt: number
  /** Bumped on every state transition (not just at creation) — the redo
   * stack's LIFO order is "most recently undone first", which is NOT the
   * same as "most recently created" once more than one entry has been
   * undone (lib/client/undo.ts `latestOf` sorts by this, not by id). */
  updatedAt: number
}

export interface PreferenceRow {
  key: string
  value: string | null
}

class RewindDB extends Dexie {
  events!: EntityTable<AnyEvent, 'id'>
  outbox!: EntityTable<OutboxRow, 'id'>
  tasks!: EntityTable<TaskState, 'id'>
  lists!: EntityTable<ListState, 'id'>
  preferences!: EntityTable<PreferenceRow, 'key'>
  syncMeta!: EntityTable<SyncMetaRow, 'id'>
  undoStack!: EntityTable<UndoEntryRow, 'id'>

  constructor() {
    super('rewind')
    this.version(1).stores({
      // entity_type indexed for the 'user' (preferences) bucket scan;
      // entity_id for per-entity replay (rebuildLocalProjection);
      // [entity_id+client_timestamp] for per-task history, oldest first.
      events: 'id, entity_id, entity_type, type, [entity_id+client_timestamp]',
      outbox: 'id, createdAt',
      tasks: 'id, list_id, parent_task_id, deleted, position',
      lists: 'id, archived, position',
      preferences: 'key',
      syncMeta: 'id',
      undoStack: '++id, state, createdAt',
    })
  }
}

export const db = new RewindDB()
