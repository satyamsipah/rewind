import { describe, expect, it } from 'vitest'
import type { TaskState } from '@/lib/domain/state'
import { applyViewFilter, searchTasks } from './filters'

function task(overrides: Partial<TaskState>): TaskState {
  return {
    id: 'id',
    list_id: 'list',
    title: 'Task',
    position: 'a0',
    parent_task_id: null,
    completed: false,
    completed_at: null,
    due_date: null,
    priority: null,
    note: null,
    tags: [],
    deleted: false,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const now = new Date('2026-06-15T12:00:00.000Z')

describe('applyViewFilter', () => {
  const tasks = [
    task({ id: 'a', due_date: '2026-06-15T18:00:00.000Z' }), // today
    task({ id: 'b', due_date: '2026-06-20T00:00:00.000Z' }), // upcoming
    task({ id: 'c', completed: true }),
    task({ id: 'd', deleted: true }),
    task({ id: 'e' }), // no due date, active
  ]

  it('"all" excludes deleted only', () => {
    expect(applyViewFilter(tasks, 'all', now).map((t) => t.id)).toEqual(['a', 'b', 'c', 'e'])
  })

  it('"today" is due-today, active tasks only', () => {
    expect(applyViewFilter(tasks, 'today', now).map((t) => t.id)).toEqual(['a'])
  })

  it('"upcoming" is due-after-today, active tasks only', () => {
    expect(applyViewFilter(tasks, 'upcoming', now).map((t) => t.id)).toEqual(['b'])
  })

  it('"completed" excludes deleted', () => {
    expect(applyViewFilter(tasks, 'completed', now).map((t) => t.id)).toEqual(['c'])
  })
})

describe('searchTasks', () => {
  const tasks = [task({ id: 'a', title: 'Write report' }), task({ id: 'b', title: 'Buy milk', tags: ['errand'] }), task({ id: 'c', title: 'Call mom', note: 'about the report' })]

  it('matches title', () => {
    expect(searchTasks(tasks, 'report').map((t) => t.id).sort()).toEqual(['a', 'c'])
  })

  it('matches tags', () => {
    expect(searchTasks(tasks, 'errand').map((t) => t.id)).toEqual(['b'])
  })

  it('is case-insensitive', () => {
    expect(searchTasks(tasks, 'MILK').map((t) => t.id)).toEqual(['b'])
  })

  it('an empty query returns everything unfiltered', () => {
    expect(searchTasks(tasks, '')).toEqual(tasks)
  })
})
