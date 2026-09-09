import type { AnyEvent, EventOfType } from '@/lib/events/schemas'
import { upcast } from '@/lib/events/upcast'
import type { AppState, ListState, TaskState } from './state'
import { emptyState } from './state'
import { resolveBiasedBoolean, resolveField, type FieldWrite } from './merge'

/** Bump whenever reduce()'s field logic changes in a way that could
 * change resolved output for existing events. lib/db/snapshots.ts stores
 * this alongside every snapshot and ignores (recomputes) any snapshot
 * whose reducer_version doesn't match — so a reducer change invalidates
 * every snapshot automatically instead of silently serving stale state. */
export const REDUCER_VERSION = 1

/**
 * `reduce(events) => AppState` is the single pure function this whole
 * system is built on (.claude/rules/domain.md): no Date.now(), no
 * randomness, no I/O — every value in the output is derived solely from
 * fields already present on the input events. Calling it twice with the
 * same (possibly differently-ordered) array must yield identical state;
 * see reducer.test.ts "purity" and "order independence".
 *
 * Unlike a typical event-sourcing fold that applies events one at a time
 * in a fixed order, this reducer resolves each field by collecting EVERY
 * write that field ever received across the whole array and running it
 * through resolveField/resolveBiasedBoolean (merge.ts) once. That
 * "maximal frontier" resolution is a pure function of the write SET, not
 * of arrival order — so passing events in a different order (e.g. two
 * clients that synced in opposite directions) provably produces the same
 * state. That is what the divergence test relies on.
 */
export function reduce(events: AnyEvent[]): AppState {
  const state = emptyState()
  const upcasted = events.map(upcast)

  const byEntity = new Map<string, AnyEvent[]>()
  for (const event of upcasted) {
    const bucket = byEntity.get(event.entity_id)
    if (bucket) bucket.push(event)
    else byEntity.set(event.entity_id, [event])
  }

  for (const [entityId, entityEvents] of byEntity) {
    const entityType = entityEvents[0]!.entity_type
    if (entityType === 'task') {
      state.tasks[entityId] = buildTask(entityId, entityEvents)
    } else {
      state.lists[entityId] = buildList(entityId, entityEvents)
    }
  }

  return state
}

function write<T extends AnyEvent, V>(event: T, value: V): FieldWrite<V> {
  return {
    value,
    clock: event.vector_clock,
    client_timestamp: event.client_timestamp,
    device_id: event.device_id,
    event_id: event.id,
  }
}

function earliestTimestamp(events: AnyEvent[]): string {
  return events.reduce((min, e) => (e.client_timestamp < min ? e.client_timestamp : min), events[0]!.client_timestamp)
}

function buildTask(id: string, events: AnyEvent[]): TaskState {
  const created = events.find((e): e is EventOfType<'TaskCreated'> => e.type === 'TaskCreated')

  const titleWrites: FieldWrite<string>[] = []
  const moveWrites: FieldWrite<{ list_id: string; position: string }>[] = []
  const doneWrites: FieldWrite<{ completed: boolean; completed_at: string | null }>[] = []
  const dueDateWrites: FieldWrite<string | null>[] = []
  const priorityWrites: FieldWrite<string | null>[] = []
  const noteWrites: FieldWrite<string | null>[] = []
  const deletedWrites: FieldWrite<boolean>[] = []
  const tagWrites = new Map<string, FieldWrite<boolean>[]>()

  if (created) {
    titleWrites.push(write(created, created.payload.title))
    moveWrites.push(write(created, { list_id: created.payload.list_id, position: created.payload.position }))
  }

  for (const event of events) {
    switch (event.type) {
      case 'TaskRenamed':
        titleWrites.push(write(event, event.payload.to))
        break
      case 'TaskMoved':
        moveWrites.push(write(event, event.payload.to))
        break
      case 'TaskCompleted':
        doneWrites.push(write(event, { completed: true, completed_at: event.payload.completed_at }))
        break
      case 'TaskUncompleted':
        doneWrites.push(write(event, { completed: false, completed_at: null }))
        break
      case 'TaskDueDateSet':
        dueDateWrites.push(write(event, event.payload.to))
        break
      case 'TaskPriorityChanged':
        priorityWrites.push(write(event, event.payload.to))
        break
      case 'NoteAttached':
        noteWrites.push(write(event, event.payload.to))
        break
      case 'TaskDeleted':
        deletedWrites.push(write(event, true))
        break
      case 'TaskRestored':
        deletedWrites.push(write(event, false))
        break
      case 'TagAdded': {
        const bucket = tagWrites.get(event.payload.tag) ?? []
        bucket.push(write(event, true))
        tagWrites.set(event.payload.tag, bucket)
        break
      }
      case 'TagRemoved': {
        const bucket = tagWrites.get(event.payload.tag) ?? []
        bucket.push(write(event, false))
        tagWrites.set(event.payload.tag, bucket)
        break
      }
      default:
        break
    }
  }

  const move = moveWrites.length > 0 ? resolveField(moveWrites).value : { list_id: '', position: '' }
  const done =
    doneWrites.length > 0 ? resolveField(doneWrites).value : { completed: false, completed_at: null as string | null }

  const tags = [...tagWrites.entries()]
    .filter(([, writes]) => resolveBiasedBoolean(writes, true).value === true)
    .map(([tag]) => tag)
    .sort()

  return {
    id,
    list_id: move.list_id,
    title: titleWrites.length > 0 ? resolveField(titleWrites).value : '',
    position: move.position,
    completed: done.completed,
    completed_at: done.completed_at,
    due_date: dueDateWrites.length > 0 ? resolveField(dueDateWrites).value : null,
    priority: priorityWrites.length > 0 ? (resolveField(priorityWrites).value as TaskState['priority']) : null,
    note: noteWrites.length > 0 ? resolveField(noteWrites).value : null,
    tags,
    deleted: deletedWrites.length > 0 ? resolveBiasedBoolean(deletedWrites, false).value : false,
    created_at: created?.client_timestamp ?? earliestTimestamp(events),
  }
}

function buildList(id: string, events: AnyEvent[]): ListState {
  const created = events.find((e): e is EventOfType<'ListCreated'> => e.type === 'ListCreated')

  const nameWrites: FieldWrite<string>[] = []
  const positionWrites: FieldWrite<string>[] = []
  const archivedWrites: FieldWrite<boolean>[] = []

  if (created) {
    nameWrites.push(write(created, created.payload.name))
    positionWrites.push(write(created, created.payload.position))
  }

  for (const event of events) {
    switch (event.type) {
      case 'ListRenamed':
        nameWrites.push(write(event, event.payload.to))
        break
      case 'ListArchived':
        archivedWrites.push(write(event, event.payload.to))
        break
      default:
        break
    }
  }

  return {
    id,
    name: nameWrites.length > 0 ? resolveField(nameWrites).value : '',
    position: positionWrites.length > 0 ? resolveField(positionWrites).value : '',
    archived: archivedWrites.length > 0 ? resolveField(archivedWrites).value : false,
    created_at: created?.client_timestamp ?? earliestTimestamp(events),
  }
}
