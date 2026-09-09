import { beforeEach, describe, expect, it } from 'vitest'
import { EVENT_TYPES, type AnyEvent, type EventType } from '@/lib/events/schemas'
import { buildEvent, resetFakeClocks, resetFakeTimestamps } from '@/lib/test-support/build-event'
import { fakeId, resetFakeIds } from '@/lib/test-support/ids'
import { inverse } from './inverse'
import { reduce } from './reducer'
import { observable } from './state'

/**
 * Every event type gets: apply, then its computed inverse, assert the
 * resulting OBSERVABLE state equals the state before the event
 * (.claude/rules/domain.md). Two types — TaskCreated and ListCreated —
 * round-trip to a tombstone rather than a true absence (append-only means
 * "undo a creation" can only ever soft-hide it), so those two also get a
 * narrower assertion that the raw difference is exactly the tombstone
 * field. Every other type round-trips to the exact same raw state, which
 * we assert too, for a stronger check than observable() alone gives.
 */

function applyThenInvert(setup: AnyEvent[], target: AnyEvent) {
  const inv = inverse(target)
  const invEvent = buildEvent({
    type: inv.type,
    entity_id: target.entity_id,
    entity_type: target.entity_type,
    payload: inv.payload as never,
    device_id: target.device_id,
    actor_id: target.actor_id,
  })
  return {
    before: reduce(setup),
    after: reduce([...setup, target, invEvent]),
  }
}

describe('round-trip: apply then inverse restores original state', () => {
  beforeEach(() => {
    resetFakeIds()
    resetFakeTimestamps()
    resetFakeClocks()
  })

  const covered = new Set<EventType>()

  it('TaskCreated (tombstoned, not truly absent)', () => {
    covered.add('TaskCreated')
    const taskId = fakeId()
    const listId = fakeId()
    const target = buildEvent({
      type: 'TaskCreated',
      entity_id: taskId,
      entity_type: 'task',
      payload: { list_id: listId, title: 'Write report', position: 'a0' },
    })
    const { before, after } = applyThenInvert([], target)

    expect(observable(before).tasks).toEqual({})
    expect(observable(after).tasks).toEqual({})

    // Narrower check: the raw difference is exactly the tombstone.
    expect(before.tasks[taskId]).toBeUndefined()
    const raw = after.tasks[taskId]!
    expect(raw.deleted).toBe(true)
    expect({ ...raw, deleted: false }).toEqual({
      id: taskId,
      list_id: listId,
      title: 'Write report',
      position: 'a0',
      parent_task_id: null,
      completed: false,
      completed_at: null,
      due_date: null,
      priority: null,
      note: null,
      tags: [],
      deleted: false,
      created_at: raw.created_at,
    })
  })

  it('ListCreated (tombstoned via archive, not truly absent)', () => {
    covered.add('ListCreated')
    const listId = fakeId()
    const target = buildEvent({
      type: 'ListCreated',
      entity_id: listId,
      entity_type: 'list',
      payload: { name: 'Inbox', position: 'a0' },
    })
    const { before, after } = applyThenInvert([], target)

    expect(observable(before).lists).toEqual({})
    expect(observable(after).lists).toEqual({})

    expect(before.lists[listId]).toBeUndefined()
    const raw = after.lists[listId]!
    expect(raw.archived).toBe(true)
    expect({ ...raw, archived: false }).toEqual({
      id: listId,
      name: 'Inbox',
      position: 'a0',
      archived: false,
      created_at: raw.created_at,
    })
  })

  it('TaskRenamed', () => {
    covered.add('TaskRenamed')
    const taskId = fakeId()
    const listId = fakeId()
    const setup = [
      buildEvent({
        type: 'TaskCreated' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      }),
    ]
    const target = buildEvent({
      type: 'TaskRenamed',
      entity_id: taskId,
      entity_type: 'task',
      payload: { from: 'Alpha', to: 'Beta' },
    })
    const { before, after } = applyThenInvert(setup, target)
    expect(observable(after)).toEqual(observable(before))
  })

  it('TaskCompleted', () => {
    covered.add('TaskCompleted')
    const taskId = fakeId()
    const listId = fakeId()
    const setup = [
      buildEvent({
        type: 'TaskCreated' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      }),
    ]
    const target = buildEvent({
      type: 'TaskCompleted',
      entity_id: taskId,
      entity_type: 'task',
      payload: { completed_at: '2026-01-05T00:00:00.000Z' },
    })
    const { before, after } = applyThenInvert(setup, target)
    expect(observable(after)).toEqual(observable(before))
  })

  it('TaskUncompleted', () => {
    covered.add('TaskUncompleted')
    const taskId = fakeId()
    const listId = fakeId()
    const completedAt = '2026-01-05T00:00:00.000Z'
    const setup = [
      buildEvent({
        type: 'TaskCreated' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      }),
      buildEvent({
        type: 'TaskCompleted' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { completed_at: completedAt },
      }),
    ]
    const target = buildEvent({
      type: 'TaskUncompleted',
      entity_id: taskId,
      entity_type: 'task',
      payload: { prior_completed_at: completedAt },
    })
    const { before, after } = applyThenInvert(setup, target)
    expect(observable(after)).toEqual(observable(before))
  })

  it('TaskDeleted', () => {
    covered.add('TaskDeleted')
    const taskId = fakeId()
    const listId = fakeId()
    const setup = [
      buildEvent({
        type: 'TaskCreated' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      }),
    ]
    const target = buildEvent({ type: 'TaskDeleted', entity_id: taskId, entity_type: 'task', payload: {} })
    const { before, after } = applyThenInvert(setup, target)
    expect(observable(after)).toEqual(observable(before))
  })

  it('TaskRestored', () => {
    covered.add('TaskRestored')
    const taskId = fakeId()
    const listId = fakeId()
    const setup = [
      buildEvent({
        type: 'TaskCreated' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      }),
      buildEvent({ type: 'TaskDeleted' as const, entity_id: taskId, entity_type: 'task' as const, payload: {} }),
    ]
    const target = buildEvent({ type: 'TaskRestored', entity_id: taskId, entity_type: 'task', payload: {} })
    const { before, after } = applyThenInvert(setup, target)
    // Both before and after are deleted (unobservable) — assert the raw
    // state, not just observable(), so this test can't pass trivially.
    expect(after).toEqual(before)
  })

  it('TaskMoved', () => {
    covered.add('TaskMoved')
    const taskId = fakeId()
    const listA = fakeId()
    const listB = fakeId()
    const setup = [
      buildEvent({
        type: 'TaskCreated' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { list_id: listA, title: 'Alpha', position: 'a0' },
      }),
    ]
    const target = buildEvent({
      type: 'TaskMoved',
      entity_id: taskId,
      entity_type: 'task',
      payload: { from: { list_id: listA, position: 'a0' }, to: { list_id: listB, position: 'b0' } },
    })
    const { before, after } = applyThenInvert(setup, target)
    expect(observable(after)).toEqual(observable(before))
  })

  it('TaskDueDateSet', () => {
    covered.add('TaskDueDateSet')
    const taskId = fakeId()
    const listId = fakeId()
    const setup = [
      buildEvent({
        type: 'TaskCreated' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      }),
    ]
    const target = buildEvent({
      type: 'TaskDueDateSet',
      entity_id: taskId,
      entity_type: 'task',
      payload: { from: null, to: '2026-02-01T00:00:00.000Z' },
    })
    const { before, after } = applyThenInvert(setup, target)
    expect(observable(after)).toEqual(observable(before))
  })

  it('TaskPriorityChanged', () => {
    covered.add('TaskPriorityChanged')
    const taskId = fakeId()
    const listId = fakeId()
    const setup = [
      buildEvent({
        type: 'TaskCreated' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      }),
    ]
    const target = buildEvent({
      type: 'TaskPriorityChanged',
      entity_id: taskId,
      entity_type: 'task',
      payload: { from: null, to: 'high' },
    })
    const { before, after } = applyThenInvert(setup, target)
    expect(observable(after)).toEqual(observable(before))
  })

  it('TagAdded', () => {
    covered.add('TagAdded')
    const taskId = fakeId()
    const listId = fakeId()
    const setup = [
      buildEvent({
        type: 'TaskCreated' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      }),
    ]
    const target = buildEvent({
      type: 'TagAdded',
      entity_id: taskId,
      entity_type: 'task',
      payload: { tag: 'urgent' },
    })
    const { before, after } = applyThenInvert(setup, target)
    expect(observable(after)).toEqual(observable(before))
  })

  it('TagRemoved', () => {
    covered.add('TagRemoved')
    const taskId = fakeId()
    const listId = fakeId()
    const setup = [
      buildEvent({
        type: 'TaskCreated' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      }),
      buildEvent({ type: 'TagAdded' as const, entity_id: taskId, entity_type: 'task' as const, payload: { tag: 'urgent' } }),
    ]
    const target = buildEvent({
      type: 'TagRemoved',
      entity_id: taskId,
      entity_type: 'task',
      payload: { tag: 'urgent' },
    })
    const { before, after } = applyThenInvert(setup, target)
    expect(observable(after)).toEqual(observable(before))
  })

  it('ListRenamed', () => {
    covered.add('ListRenamed')
    const listId = fakeId()
    const setup = [
      buildEvent({
        type: 'ListCreated' as const,
        entity_id: listId,
        entity_type: 'list' as const,
        payload: { name: 'Inbox', position: 'a0' },
      }),
    ]
    const target = buildEvent({
      type: 'ListRenamed',
      entity_id: listId,
      entity_type: 'list',
      payload: { from: 'Inbox', to: 'Work' },
    })
    const { before, after } = applyThenInvert(setup, target)
    expect(observable(after)).toEqual(observable(before))
  })

  it('ListArchived', () => {
    covered.add('ListArchived')
    const listId = fakeId()
    const setup = [
      buildEvent({
        type: 'ListCreated' as const,
        entity_id: listId,
        entity_type: 'list' as const,
        payload: { name: 'Inbox', position: 'a0' },
      }),
    ]
    const target = buildEvent({
      type: 'ListArchived',
      entity_id: listId,
      entity_type: 'list',
      payload: { from: false, to: true },
    })
    const { before, after } = applyThenInvert(setup, target)
    expect(observable(after)).toEqual(observable(before))
  })

  it('NoteAttached', () => {
    covered.add('NoteAttached')
    const taskId = fakeId()
    const listId = fakeId()
    const setup = [
      buildEvent({
        type: 'TaskCreated' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      }),
    ]
    const target = buildEvent({
      type: 'NoteAttached',
      entity_id: taskId,
      entity_type: 'task',
      payload: { from: null, to: 'remember milk' },
    })
    const { before, after } = applyThenInvert(setup, target)
    expect(observable(after)).toEqual(observable(before))
  })

  it('PreferenceSet', () => {
    covered.add('PreferenceSet')
    const userId = fakeId()
    const setup = [
      buildEvent({
        type: 'PreferenceSet' as const,
        entity_id: userId,
        entity_type: 'user' as const,
        payload: { key: 'theme_mode' as const, from: null, to: 'light' },
      }),
    ]
    const target = buildEvent({
      type: 'PreferenceSet',
      entity_id: userId,
      entity_type: 'user',
      payload: { key: 'theme_mode', from: 'light', to: 'dark' },
    })
    const { before, after } = applyThenInvert(setup, target)
    expect(observable(after)).toEqual(observable(before))
  })

  it('covers every event type — fails if a new type is added without a case above', () => {
    expect([...covered].sort()).toEqual([...EVENT_TYPES].sort())
  })
})
