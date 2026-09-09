import { beforeEach, describe, expect, it } from 'vitest'
import { buildEvent, resetFakeClocks, resetFakeTimestamps } from '@/lib/test-support/build-event'
import { fakeId, resetFakeIds } from '@/lib/test-support/ids'
import { canonical } from './canonical'
import { reduce } from './reducer'

/**
 * .claude/rules/domain.md: the reducer must be pure — same events in,
 * same state out, every time. This asserts that property directly
 * (running reduce() twice on an identical array), and separately that the
 * result does not depend on the ORDER events are supplied in, which is
 * what the sync protocol needs (a client can receive another device's
 * events in any order relative to its own).
 */
describe('reducer purity', () => {
  beforeEach(() => {
    resetFakeIds()
    resetFakeTimestamps()
    resetFakeClocks()
  })

  it('running reduce() twice on the same array gives identical output', () => {
    const taskId = fakeId()
    const listId = fakeId()
    const events = [
      buildEvent({
        type: 'TaskCreated' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      }),
      buildEvent({
        type: 'TaskRenamed' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { from: 'Alpha', to: 'Beta' },
      }),
    ]

    expect(canonical(reduce(events))).toBe(canonical(reduce(events)))
  })

  it('does not mutate its input array or the event objects within it', () => {
    const taskId = fakeId()
    const listId = fakeId()
    const events = [
      buildEvent({
        type: 'TaskCreated' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      }),
    ]
    const snapshot = JSON.stringify(events)
    reduce(events)
    expect(JSON.stringify(events)).toBe(snapshot)
  })

  it('order independence: shuffled input reduces to the same state as original order', () => {
    const taskId = fakeId()
    const listId = fakeId()
    const events = [
      buildEvent({
        type: 'TaskCreated' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { list_id: listId, title: 'Alpha', position: 'a0' },
      }),
      buildEvent({
        type: 'TaskRenamed' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { from: 'Alpha', to: 'Beta' },
      }),
      buildEvent({
        type: 'TaskCompleted' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { completed_at: '2026-01-05T00:00:00.000Z' },
      }),
    ]
    const forward = canonical(reduce(events))
    const reversed = canonical(reduce([...events].reverse()))
    expect(reversed).toBe(forward)
  })
})
