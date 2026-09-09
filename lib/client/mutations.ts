import type { Priority } from '@/lib/events/schemas'
import { appendLocalEvent } from './append'
import { pushUndoEntry } from './undo'
import { db } from './db'
import { getCachedUserId } from './identity'
import { notifyLocalMutation } from './sync-engine'

/**
 * The write surface every UI component calls. Every function here: (1)
 * mints and appends one event through lib/client/append.ts — local log,
 * outbox, and projection updated in the same transaction, no network
 * involved — then (2) pushes an undo-stack entry, so every user action
 * is undoable by construction rather than by remembering to opt in.
 *
 * CLAUDE.md "No business logic in components": components call these,
 * never construct events themselves.
 */

async function act(fn: () => Promise<{ id: string }>): Promise<void> {
  const event = await fn()
  await pushUndoEntry(event.id)
  notifyLocalMutation()
}

export async function createList(name: string, position: string): Promise<string> {
  const id = crypto.randomUUID()
  await act(() => appendLocalEvent({ type: 'ListCreated', entity_id: id, entity_type: 'list', payload: { name, position } }))
  return id
}

export async function renameList(listId: string, newName: string): Promise<void> {
  const list = await db.lists.get(listId)
  if (!list) throw new Error(`unknown list ${listId}`)
  await act(() =>
    appendLocalEvent({
      type: 'ListRenamed',
      entity_id: listId,
      entity_type: 'list',
      payload: { from: list.name, to: newName },
    }),
  )
}

export async function setListArchived(listId: string, archived: boolean): Promise<void> {
  const list = await db.lists.get(listId)
  if (!list) throw new Error(`unknown list ${listId}`)
  await act(() =>
    appendLocalEvent({
      type: 'ListArchived',
      entity_id: listId,
      entity_type: 'list',
      payload: { from: list.archived, to: archived },
    }),
  )
}

export interface CreateTaskInput {
  listId: string
  title: string
  position: string
  parentTaskId?: string | null
}

export async function createTask(input: CreateTaskInput): Promise<string> {
  const id = crypto.randomUUID()
  await act(() =>
    appendLocalEvent({
      type: 'TaskCreated',
      entity_id: id,
      entity_type: 'task',
      payload: {
        list_id: input.listId,
        title: input.title,
        position: input.position,
        parent_task_id: input.parentTaskId ?? null,
      },
    }),
  )
  return id
}

export async function renameTask(taskId: string, newTitle: string): Promise<void> {
  const task = await db.tasks.get(taskId)
  if (!task) throw new Error(`unknown task ${taskId}`)
  await act(() =>
    appendLocalEvent({
      type: 'TaskRenamed',
      entity_id: taskId,
      entity_type: 'task',
      payload: { from: task.title, to: newTitle },
    }),
  )
}

export async function setTaskCompleted(taskId: string, completed: boolean): Promise<void> {
  const task = await db.tasks.get(taskId)
  if (!task) throw new Error(`unknown task ${taskId}`)
  if (completed) {
    await act(() =>
      appendLocalEvent({
        type: 'TaskCompleted',
        entity_id: taskId,
        entity_type: 'task',
        payload: { completed_at: new Date().toISOString() },
      }),
    )
  } else {
    await act(() =>
      appendLocalEvent({
        type: 'TaskUncompleted',
        entity_id: taskId,
        entity_type: 'task',
        payload: { prior_completed_at: task.completed_at ?? new Date().toISOString() },
      }),
    )
  }
}

export async function setTaskDeleted(taskId: string, deleted: boolean): Promise<void> {
  await act(() =>
    appendLocalEvent({
      type: deleted ? 'TaskDeleted' : 'TaskRestored',
      entity_id: taskId,
      entity_type: 'task',
      payload: {},
    }),
  )
}

export interface MoveTaskInput {
  listId: string
  position: string
  parentTaskId?: string | null
}

/** Reordering, moving to another list, and (de)promoting to/from a
 * subtask are all the SAME event — the atomic {list_id, position,
 * parent_task_id} pair (docs/DECISIONS.md) — so a drag-and-drop reorder
 * is exactly one event, never N. */
export async function moveTask(taskId: string, to: MoveTaskInput): Promise<void> {
  const task = await db.tasks.get(taskId)
  if (!task) throw new Error(`unknown task ${taskId}`)
  await act(() =>
    appendLocalEvent({
      type: 'TaskMoved',
      entity_id: taskId,
      entity_type: 'task',
      payload: {
        from: { list_id: task.list_id, position: task.position, parent_task_id: task.parent_task_id },
        to: { list_id: to.listId, position: to.position, parent_task_id: to.parentTaskId ?? null },
      },
    }),
  )
}

export async function setTaskDueDate(taskId: string, dueDate: string | null): Promise<void> {
  const task = await db.tasks.get(taskId)
  if (!task) throw new Error(`unknown task ${taskId}`)
  await act(() =>
    appendLocalEvent({
      type: 'TaskDueDateSet',
      entity_id: taskId,
      entity_type: 'task',
      payload: { from: task.due_date, to: dueDate },
    }),
  )
}

export async function setTaskPriority(taskId: string, priority: Priority | null): Promise<void> {
  const task = await db.tasks.get(taskId)
  if (!task) throw new Error(`unknown task ${taskId}`)
  await act(() =>
    appendLocalEvent({
      type: 'TaskPriorityChanged',
      entity_id: taskId,
      entity_type: 'task',
      payload: { from: task.priority, to: priority },
    }),
  )
}

export async function setTaskNote(taskId: string, note: string | null): Promise<void> {
  const task = await db.tasks.get(taskId)
  if (!task) throw new Error(`unknown task ${taskId}`)
  await act(() =>
    appendLocalEvent({
      type: 'NoteAttached',
      entity_id: taskId,
      entity_type: 'task',
      payload: { from: task.note, to: note },
    }),
  )
}

export async function addTag(taskId: string, tag: string): Promise<void> {
  await act(() => appendLocalEvent({ type: 'TagAdded', entity_id: taskId, entity_type: 'task', payload: { tag } }))
}

export async function removeTag(taskId: string, tag: string): Promise<void> {
  await act(() => appendLocalEvent({ type: 'TagRemoved', entity_id: taskId, entity_type: 'task', payload: { tag } }))
}

export async function setPreference(
  key: 'theme_mode' | 'theme_accent' | 'theme_custom',
  value: string | null,
): Promise<void> {
  const userId = getCachedUserId()
  if (!userId) throw new Error('cannot set a preference before a user has signed in at least once')
  const current = await db.preferences.get(key)
  await act(() =>
    appendLocalEvent({
      type: 'PreferenceSet',
      entity_id: userId,
      entity_type: 'user',
      payload: { key, from: current?.value ?? null, to: value },
    }),
  )
}
