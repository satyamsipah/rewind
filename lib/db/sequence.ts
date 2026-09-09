import { sql } from 'drizzle-orm'
import { eventSequences } from './schema'
import type { Db } from './client'

/**
 * Allocates the next `user_seq` values for a batch of new events,
 * serialised per-user via a row lock. Must be called inside the same
 * transaction that inserts the events — see docs/DECISIONS.md "Why
 * user_seq, not a timestamp cursor" for why this can't be a plain
 * `bigserial`: a DB sequence (like `now()`) is allocated pre-commit, so a
 * client polling `WHERE server_timestamp > cursor` can miss a
 * still-in-flight earlier transaction that commits later. Locking this
 * row makes allocation — and therefore commit order — match `user_seq`
 * order exactly.
 *
 * Built on the query builder's `.onConflictDoUpdate().returning()`
 * rather than a raw `sql\`...RETURNING\`` string: `.returning()` is
 * normalised to a plain row array by every Drizzle driver, whereas a raw
 * `.execute()` call's return shape differs between drivers (postgres-js
 * returns an array-like directly; the PGlite driver used in integration
 * tests returns `{ rows: [...] }`). Using the query builder keeps this
 * function identical in production and under test — the whole point of
 * PGlite integration tests (docs/DECISIONS.md).
 */
export async function allocateUserSeq(tx: Db, userId: string, count: number): Promise<bigint> {
  if (count === 0) return 0n

  const [row] = await tx
    .insert(eventSequences)
    .values({ userId, lastSeq: BigInt(count) })
    .onConflictDoUpdate({
      target: eventSequences.userId,
      set: { lastSeq: sql`${eventSequences.lastSeq} + ${count}` },
    })
    .returning({ lastSeq: eventSequences.lastSeq })

  if (!row) throw new Error(`failed to allocate user_seq for user ${userId}`)
  // lastSeq is now the HIGHEST seq allocated in this batch; the batch
  // occupies (lastSeq - count, lastSeq].
  return row.lastSeq
}
