import { describe, expect, it } from 'vitest'
import { buildEvent } from '@/lib/test-support/build-event'
import { DEVICE_A, DEVICE_B, fakeId } from '@/lib/test-support/ids'
import { reduce } from './reducer'
import { canonical } from './canonical'

/**
 * Two devices edit the same task offline from a common synced base, then
 * "sync" — i.e. the two event streams are concatenated and fed to
 * reduce(). Each scenario below is one row of the merge table in
 * docs/DECISIONS.md. For every scenario we assert BOTH:
 *   1. the specific outcome the chosen merge rule (lib/domain/merge.ts)
 *      promises for that pair, and
 *   2. that syncing A's-events-then-B's gives the identical canonical
 *      state as B's-then-A's — CLAUDE.md principle 5, "conflicts merge,
 *      they do not overwrite", requires this to hold regardless of which
 *      device happens to sync first.
 */

function assertConverges(forward: ReturnType<typeof buildEvent>[]) {
  const a = canonical(reduce(forward))
  const b = canonical(reduce([...forward].reverse()))
  expect(b).toBe(a)
  return JSON.parse(a)
}

describe('divergence: concurrent offline edits merge per docs/DECISIONS.md table', () => {
  it('TagAdded(x) ∥ TagAdded(y): both tags survive', () => {
    const taskId = fakeId()
    const listId = fakeId()
    const created = buildEvent({
      type: 'TaskCreated',
      entity_id: taskId,
      entity_type: 'task',
      payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      device_id: DEVICE_A,
      vector_clock: { [DEVICE_A]: 1 },
    })
    const addUrgent = buildEvent({
      type: 'TagAdded',
      entity_id: taskId,
      entity_type: 'task',
      payload: { tag: 'urgent' },
      device_id: DEVICE_A,
      vector_clock: { [DEVICE_A]: 2 },
    })
    const addBlocked = buildEvent({
      type: 'TagAdded',
      entity_id: taskId,
      entity_type: 'task',
      payload: { tag: 'blocked' },
      device_id: DEVICE_B,
      vector_clock: { [DEVICE_A]: 1, [DEVICE_B]: 1 },
    })

    const state = assertConverges([created, addUrgent, addBlocked])
    expect(state.tasks[taskId].tags).toEqual(['blocked', 'urgent'])
  })

  it('TagAdded(x) ∥ TagRemoved(x): add wins, tag survives', () => {
    const taskId = fakeId()
    const listId = fakeId()
    const created = buildEvent({
      type: 'TaskCreated',
      entity_id: taskId,
      entity_type: 'task',
      payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      device_id: DEVICE_A,
      vector_clock: { [DEVICE_A]: 1 },
    })
    const add = buildEvent({
      type: 'TagAdded',
      entity_id: taskId,
      entity_type: 'task',
      payload: { tag: 'urgent' },
      device_id: DEVICE_A,
      vector_clock: { [DEVICE_A]: 2 },
    })
    const remove = buildEvent({
      type: 'TagRemoved',
      entity_id: taskId,
      entity_type: 'task',
      payload: { tag: 'urgent' },
      device_id: DEVICE_B,
      vector_clock: { [DEVICE_A]: 1, [DEVICE_B]: 1 },
    })

    const state = assertConverges([created, add, remove])
    expect(state.tasks[taskId].tags).toEqual(['urgent'])
  })

  it('Delete ∥ Rename: disjoint fields, both survive', () => {
    const taskId = fakeId()
    const listId = fakeId()
    const created = buildEvent({
      type: 'TaskCreated',
      entity_id: taskId,
      entity_type: 'task',
      payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      device_id: DEVICE_A,
      vector_clock: { [DEVICE_A]: 1 },
    })
    const deleted = buildEvent({
      type: 'TaskDeleted',
      entity_id: taskId,
      entity_type: 'task',
      payload: {},
      device_id: DEVICE_A,
      vector_clock: { [DEVICE_A]: 2 },
    })
    const renamed = buildEvent({
      type: 'TaskRenamed',
      entity_id: taskId,
      entity_type: 'task',
      payload: { from: 'Alpha', to: 'Beta' },
      device_id: DEVICE_B,
      vector_clock: { [DEVICE_A]: 1, [DEVICE_B]: 1 },
    })

    const state = assertConverges([created, deleted, renamed])
    // Raw (non-observable) state: both writes took effect even though the
    // task is now a tombstone — a later restore would surface "Beta".
    expect(state.tasks[taskId].deleted).toBe(true)
    expect(state.tasks[taskId].title).toBe('Beta')
  })

  it('Delete ∥ Restore: restore wins (never silently lose data)', () => {
    const taskId = fakeId()
    const listId = fakeId()
    const created = buildEvent({
      type: 'TaskCreated',
      entity_id: taskId,
      entity_type: 'task',
      payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      device_id: DEVICE_A,
      vector_clock: { [DEVICE_A]: 1 },
    })
    const deleted = buildEvent({
      type: 'TaskDeleted',
      entity_id: taskId,
      entity_type: 'task',
      payload: {},
      device_id: DEVICE_A,
      vector_clock: { [DEVICE_A]: 2 },
    })
    const restored = buildEvent({
      type: 'TaskRestored',
      entity_id: taskId,
      entity_type: 'task',
      payload: {},
      device_id: DEVICE_B,
      vector_clock: { [DEVICE_A]: 1, [DEVICE_B]: 1 },
    })

    const state = assertConverges([created, deleted, restored])
    expect(state.tasks[taskId].deleted).toBe(false)
  })

  it('Rename ∥ Rename: deterministic tiebreak, same winner regardless of sync order', () => {
    const taskId = fakeId()
    const listId = fakeId()
    const created = buildEvent({
      type: 'TaskCreated',
      entity_id: taskId,
      entity_type: 'task',
      payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      device_id: DEVICE_A,
      vector_clock: { [DEVICE_A]: 1 },
    })
    const renameA = buildEvent({
      type: 'TaskRenamed',
      entity_id: taskId,
      entity_type: 'task',
      payload: { from: 'Alpha', to: 'Bravo' },
      device_id: DEVICE_A,
      vector_clock: { [DEVICE_A]: 2 },
      client_timestamp: '2026-01-01T00:00:05.000Z',
    })
    const renameB = buildEvent({
      type: 'TaskRenamed',
      entity_id: taskId,
      entity_type: 'task',
      payload: { from: 'Alpha', to: 'Charlie' },
      device_id: DEVICE_B,
      vector_clock: { [DEVICE_A]: 1, [DEVICE_B]: 1 },
      client_timestamp: '2026-01-01T00:00:10.000Z',
    })

    const state = assertConverges([created, renameA, renameB])
    // Later client_timestamp wins the tiebreak (merge.ts tiebreakWins).
    expect(state.tasks[taskId].title).toBe('Charlie')
  })

  it('Move ∥ Move: atomic pair, never a mix-and-match of list_id and position', () => {
    const taskId = fakeId()
    const listA = fakeId()
    const listB = fakeId()
    const listC = fakeId()
    const created = buildEvent({
      type: 'TaskCreated',
      entity_id: taskId,
      entity_type: 'task',
      payload: { list_id: listA, title: 'Alpha', position: 'a0' },
      device_id: DEVICE_A,
      vector_clock: { [DEVICE_A]: 1 },
    })
    const moveToB = buildEvent({
      type: 'TaskMoved',
      entity_id: taskId,
      entity_type: 'task',
      payload: { from: { list_id: listA, position: 'a0' }, to: { list_id: listB, position: 'b0' } },
      device_id: DEVICE_A,
      vector_clock: { [DEVICE_A]: 2 },
      client_timestamp: '2026-01-01T00:00:05.000Z',
    })
    const moveToC = buildEvent({
      type: 'TaskMoved',
      entity_id: taskId,
      entity_type: 'task',
      payload: { from: { list_id: listA, position: 'a0' }, to: { list_id: listC, position: 'c0' } },
      device_id: DEVICE_B,
      vector_clock: { [DEVICE_A]: 1, [DEVICE_B]: 1 },
      client_timestamp: '2026-01-01T00:00:10.000Z',
    })

    const state = assertConverges([created, moveToB, moveToC])
    // Whichever move wins, list_id and position come from the SAME event.
    expect(state.tasks[taskId]).toMatchObject({ list_id: listC, position: 'c0' })
  })
})
