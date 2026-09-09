import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { buildEvent } from '@/lib/test-support/build-event'
import { DEVICE_A, DEVICE_B, fakeId } from '@/lib/test-support/ids'
import { canonical } from './canonical'
import { reduce } from './reducer'

/**
 * Property version of the divergence test: for ANY delivery order of a
 * fixed batch of events (not just forward/reversed), reduce() must
 * produce the same canonical state. This is what actually backs "sync in
 * both orders" in practice — a real client can receive a remote batch
 * interleaved with its own queued events in arbitrary order.
 */
describe('reducer order-independence (property)', () => {
  it('any permutation of a fixed event batch reduces to the same canonical state', () => {
    const taskId = fakeId()
    const listId = fakeId()
    const events = [
      buildEvent({
        type: 'TaskCreated' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { list_id: listId, title: 'Alpha', position: 'a0' },
        device_id: DEVICE_A,
        vector_clock: { [DEVICE_A]: 1 },
        client_timestamp: '2026-01-01T00:00:01.000Z',
      }),
      buildEvent({
        type: 'TagAdded' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { tag: 'urgent' },
        device_id: DEVICE_A,
        vector_clock: { [DEVICE_A]: 2 },
        client_timestamp: '2026-01-01T00:00:02.000Z',
      }),
      buildEvent({
        type: 'TagAdded' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { tag: 'blocked' },
        device_id: DEVICE_B,
        vector_clock: { [DEVICE_A]: 1, [DEVICE_B]: 1 },
        client_timestamp: '2026-01-01T00:00:03.000Z',
      }),
      buildEvent({
        type: 'TaskDueDateSet' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { from: null, to: '2026-02-01T00:00:00.000Z' },
        device_id: DEVICE_B,
        vector_clock: { [DEVICE_A]: 1, [DEVICE_B]: 2 },
        client_timestamp: '2026-01-01T00:00:04.000Z',
      }),
      buildEvent({
        type: 'TaskRenamed' as const,
        entity_id: taskId,
        entity_type: 'task' as const,
        payload: { from: 'Alpha', to: 'Omega' },
        device_id: DEVICE_A,
        vector_clock: { [DEVICE_A]: 3, [DEVICE_B]: 1 },
        client_timestamp: '2026-01-01T00:00:05.000Z',
      }),
    ]

    const expected = canonical(reduce(events))

    fc.assert(
      fc.property(fc.shuffledSubarray(events, { minLength: events.length }), (permuted) => {
        expect(canonical(reduce(permuted))).toBe(expected)
      }),
      { numRuns: 50 },
    )
  })
})
