import { describe as group, expect, it } from 'vitest'
import { describe } from './describe'
import type { AnyEvent } from '@/lib/events/schemas'

const LIST_A = '00000000-0000-4000-8000-00000000000a'
const LIST_B = '00000000-0000-4000-8000-00000000000b'
const TASK = '00000000-0000-4000-8000-000000000001'
const PARENT = '00000000-0000-4000-8000-000000000099'

function event(type: string, payload: unknown): AnyEvent {
  return {
    id: '01890000-0000-7000-8000-000000000001',
    schema_version: 1,
    actor_id: '00000000-0000-4000-8000-000000000001',
    device_id: '00000000-0000-4000-8000-000000000002',
    entity_id: TASK,
    entity_type: 'task',
    client_timestamp: '2026-09-10T10:00:00.000Z',
    server_timestamp: '2026-09-10T10:00:00.000Z',
    vector_clock: {},
    type,
    payload,
  } as AnyEvent
}

const move = (listId: string, parent: string | null = null) =>
  event('TaskMoved', {
    from: { list_id: LIST_A, position: 'a0' },
    to: { list_id: listId, position: 'a1', parent_task_id: parent },
  })

group('describe: TaskMoved names the list, never its id', () => {
  it('uses the list name when the context supplies it', () => {
    expect(describe(move(LIST_B), { listNames: { [LIST_B]: 'Work' } })).toBe(
      'moved task to list "Work"',
    )
  })

  it('falls back to a generic phrase rather than leaking a raw id', () => {
    // Both the no-context and unknown-id cases: a UUID in a sentence
    // meant for a human is the bug this guards against.
    for (const description of [describe(move(LIST_B)), describe(move(LIST_B), { listNames: {} })]) {
      expect(description).toBe('moved task to another list')
      expect(description).not.toContain(LIST_B)
    }
  })

  it('still reports a re-parent as a parent change, not a list move', () => {
    expect(describe(move(LIST_B, PARENT), { listNames: { [LIST_B]: 'Work' } })).toBe(
      'moved task under a new parent task',
    )
  })
})

group('describe: TaskDueDateSet renders a readable date, never an ISO string', () => {
  it('formats the due date', () => {
    expect(describe(event('TaskDueDateSet', { from: null, to: '2026-09-10T10:00:00.000Z' }))).toBe(
      'set due date to 10 Sep 2026',
    )
  })

  it('does not depend on the ambient timezone', () => {
    // describe() runs server-side (GET /history) and in the browser
    // (lib/client/history.ts); a timezone-sensitive format would render
    // the same event differently on each path. An instant late enough to
    // fall on an adjacent day in some zones still reports the same date.
    expect(describe(event('TaskDueDateSet', { from: null, to: '2026-09-10T23:30:00.000Z' }))).toBe(
      'set due date to 10 Sep 2026',
    )
    expect(describe(event('TaskDueDateSet', { from: null, to: '2026-01-01T00:30:00.000Z' }))).toBe(
      'set due date to 1 Jan 2026',
    )
  })

  it('reports the calendar date as written, not normalised to UTC', () => {
    // Midnight at +05:30 is the previous day in UTC. The date the person
    // picked is the one in the string, so it must survive intact.
    expect(describe(event('TaskDueDateSet', { from: null, to: '2026-09-10T00:00:00+05:30' }))).toBe(
      'set due date to 10 Sep 2026',
    )
  })

  it('describes clearing a due date', () => {
    expect(describe(event('TaskDueDateSet', { from: '2026-09-10T10:00:00.000Z', to: null }))).toBe(
      'cleared due date',
    )
  })
})
