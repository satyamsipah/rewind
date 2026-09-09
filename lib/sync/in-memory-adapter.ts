import type { VectorClock } from '@/lib/events/envelope'
import type { AnyEvent } from '@/lib/events/schemas'
import { reduce } from '@/lib/domain/reducer'
import type { AppState } from '@/lib/domain/state'
import { emptyState } from '@/lib/domain/state'
import type { CursorPort, OutboxPort } from './client'

/**
 * In-memory OutboxPort + CursorPort, used by tests (and available as a
 * reference implementation for a future non-browser host). Applies
 * remote events by keeping the FULL local event log and re-running
 * lib/domain/reduce() — exactly the same "replay, don't hand-merge"
 * approach lib/db/projections.ts uses server-side.
 */
export class InMemoryClientStore implements OutboxPort, CursorPort {
  private pending: AnyEvent[] = []
  private log: AnyEvent[] = []
  private sinceSeq = 0
  private clock: VectorClock = {}

  enqueue(event: AnyEvent): void {
    this.pending.push(event)
    this.log.push(event)
  }

  async getPending(): Promise<AnyEvent[]> {
    return [...this.pending]
  }

  async markAccepted(ids: string[]): Promise<void> {
    const accepted = new Set(ids)
    this.pending = this.pending.filter((e) => !accepted.has(e.id))
  }

  async applyRemote(events: AnyEvent[]): Promise<void> {
    const known = new Set(this.log.map((e) => e.id))
    for (const event of events) {
      if (!known.has(event.id)) this.log.push(event)
    }
  }

  async getSinceSeq(): Promise<number> {
    return this.sinceSeq
  }
  async setSinceSeq(seq: number): Promise<void> {
    this.sinceSeq = seq
  }
  async getClock(): Promise<VectorClock> {
    return this.clock
  }
  async setClock(clock: VectorClock): Promise<void> {
    this.clock = clock
  }

  state(): AppState {
    return this.log.length > 0 ? reduce(this.log) : emptyState()
  }
}
