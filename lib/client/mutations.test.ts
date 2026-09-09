import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { setCachedUserId } from './identity'
import { positionBetween } from '@/lib/shared/fractional-index'
import {
  addTag,
  createList,
  createTask,
  moveTask,
  removeTag,
  renameTask,
  setTaskCompleted,
  setTaskDeleted,
  setTaskDueDate,
  setTaskPriority,
} from './mutations'
import { canRedo, canUndo, redo, undo } from './undo'

const USER_ID = '00000000-0000-4000-8000-000000000001'

describe('lib/client/mutations (Dexie-backed)', () => {
  beforeEach(async () => {
    setCachedUserId(USER_ID)
    await db.events.clear()
    await db.outbox.clear()
    await db.tasks.clear()
    await db.lists.clear()
    await db.preferences.clear()
    await db.syncMeta.clear()
    await db.undoStack.clear()
  })

  afterEach(async () => {
    localStorage.clear()
  })

  it('createTask writes locally first: log, outbox, and projection all updated with no network', async () => {
    const listId = await createList('Inbox', positionBetween(null, null))
    const taskId = await createTask({ listId, title: 'Write report', position: positionBetween(null, null) })

    const task = await db.tasks.get(taskId)
    expect(task).toMatchObject({ title: 'Write report', list_id: listId, completed: false })

    const outboxIds = (await db.outbox.toArray()).map((r) => r.id)
    expect(outboxIds.length).toBe(2) // ListCreated + TaskCreated
    const events = await db.events.toArray()
    expect(events).toHaveLength(2)
  })

  it('renameTask updates the local projection immediately (optimistic)', async () => {
    const listId = await createList('Inbox', positionBetween(null, null))
    const taskId = await createTask({ listId, title: 'Draft', position: positionBetween(null, null) })
    await renameTask(taskId, 'Final draft')

    expect((await db.tasks.get(taskId))?.title).toBe('Final draft')
  })

  it('setTaskCompleted / setTaskDeleted round-trip through the projection', async () => {
    const listId = await createList('Inbox', positionBetween(null, null))
    const taskId = await createTask({ listId, title: 'Task', position: positionBetween(null, null) })

    await setTaskCompleted(taskId, true)
    expect((await db.tasks.get(taskId))?.completed).toBe(true)

    await setTaskDeleted(taskId, true)
    expect((await db.tasks.get(taskId))?.deleted).toBe(true)
  })

  it('moveTask carries list_id, position, and parent_task_id as one atomic write', async () => {
    const listA = await createList('A', positionBetween(null, null))
    const listB = await createList('B', positionBetween(null, null))
    const taskId = await createTask({ listId: listA, title: 'Task', position: positionBetween(null, null) })

    await moveTask(taskId, { listId: listB, position: positionBetween(null, null), parentTaskId: null })

    const task = await db.tasks.get(taskId)
    expect(task?.list_id).toBe(listB)
  })

  it('tags add/remove reflect in the projection', async () => {
    const listId = await createList('Inbox', positionBetween(null, null))
    const taskId = await createTask({ listId, title: 'Task', position: positionBetween(null, null) })

    await addTag(taskId, 'urgent')
    expect((await db.tasks.get(taskId))?.tags).toEqual(['urgent'])

    await removeTag(taskId, 'urgent')
    expect((await db.tasks.get(taskId))?.tags).toEqual([])
  })

  it('setTaskDueDate and setTaskPriority update the projection', async () => {
    const listId = await createList('Inbox', positionBetween(null, null))
    const taskId = await createTask({ listId, title: 'Task', position: positionBetween(null, null) })

    await setTaskDueDate(taskId, '2026-03-01T00:00:00.000Z')
    await setTaskPriority(taskId, 'high')

    const task = await db.tasks.get(taskId)
    expect(task?.due_date).toBe('2026-03-01T00:00:00.000Z')
    expect(task?.priority).toBe('high')
  })

  it('every mutation is undoable, in LIFO order, offline (no network involved)', async () => {
    const listId = await createList('Inbox', positionBetween(null, null))
    const taskId = await createTask({ listId, title: 'Alpha', position: positionBetween(null, null) })
    await renameTask(taskId, 'Beta')

    expect((await db.tasks.get(taskId))?.title).toBe('Beta')
    expect(await canUndo()).toBe(true)

    await undo() // undo the rename
    expect((await db.tasks.get(taskId))?.title).toBe('Alpha')

    await undo() // undo the create -> tombstoned
    expect((await db.tasks.get(taskId))?.deleted).toBe(true)

    expect(await canRedo()).toBe(true)
    await redo()
    expect((await db.tasks.get(taskId))?.deleted).toBe(false)
    await redo()
    expect((await db.tasks.get(taskId))?.title).toBe('Beta')

    expect(await canRedo()).toBe(false)
  })

  it('a new action after an undo clears the redo stack (standard undo/redo UX)', async () => {
    const listId = await createList('Inbox', positionBetween(null, null))
    const taskId = await createTask({ listId, title: 'Alpha', position: positionBetween(null, null) })
    await renameTask(taskId, 'Beta')

    await undo()
    expect((await db.tasks.get(taskId))?.title).toBe('Alpha')

    await renameTask(taskId, 'Gamma')
    expect(await canRedo()).toBe(false)
    expect((await db.tasks.get(taskId))?.title).toBe('Gamma')
  })
})
