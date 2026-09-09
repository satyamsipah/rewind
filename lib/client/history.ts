'use client'

import { useLiveQuery } from 'dexie-react-hooks'
import { describe } from '@/lib/domain/describe'
import { reduce } from '@/lib/domain/reducer'
import type { AppState } from '@/lib/domain/state'
import type { AnyEvent } from '@/lib/events/schemas'
import { db } from './db'

/**
 * HISTORY (item 4) — all reads over the local event log, so the
 * activity timeline, per-task lifecycle, and time-travel view all work
 * fully offline, same as everything else. Client-side time travel uses
 * `server_timestamp ?? client_timestamp`: a synced event's settled
 * server-assigned instant when it has one (matching the server's own
 * "state as the server knew it at T" semantics — docs/DECISIONS.md), and
 * falls back to the client's own clock for anything still sitting in the
 * outbox, since the client's own not-yet-synced events have no other
 * timestamp to sort by.
 */

export interface HistoryFilters {
  entityId?: string
  type?: string
  from?: string
  to?: string
}

function effectiveTimestamp(event: AnyEvent): string {
  return event.server_timestamp ?? event.client_timestamp
}

export function useActivityTimeline(filters: HistoryFilters = {}) {
  return useLiveQuery(async () => {
    let events = await db.events.toArray()
    if (filters.entityId) events = events.filter((e) => e.entity_id === filters.entityId)
    if (filters.type) events = events.filter((e) => e.type === filters.type)
    if (filters.from) events = events.filter((e) => effectiveTimestamp(e) >= filters.from!)
    if (filters.to) events = events.filter((e) => effectiveTimestamp(e) <= filters.to!)
    events.sort((a, b) => (effectiveTimestamp(a) < effectiveTimestamp(b) ? 1 : -1))
    return events.map((event) => ({ event, description: describe(event) }))
  }, [filters.entityId, filters.type, filters.from, filters.to])
}

export function useTaskHistory(taskId: string) {
  return useLiveQuery(async () => {
    const events = await db.events.where('entity_id').equals(taskId).toArray()
    events.sort((a, b) => (effectiveTimestamp(a) < effectiveTimestamp(b) ? -1 : 1))
    return events.map((event) => ({ event, description: describe(event) }))
  }, [taskId])
}

/** Time-travel: the whole board as it was at `at` (ISO instant),
 * read-only. A full local replay — the client's event log is small
 * enough (one person's history) that this needs no snapshot cache the
 * way the server does. */
export async function getStateAt(at: string): Promise<AppState> {
  const events = await db.events.toArray()
  const filtered = events.filter((e) => effectiveTimestamp(e) <= at)
  return reduce(filtered)
}
