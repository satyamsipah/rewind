import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

/**
 * Driver-agnostic database type. lib/sync/server.ts, lib/db/projections.ts
 * and lib/db/sequence.ts all take a `Db`, so the exact same code runs
 * against the real postgres-js connection in production and the
 * PGlite-backed connection in integration tests (test/integration/db.ts)
 * — the whole point of testing against a real Postgres engine rather than
 * a hand-rolled mock (docs/DECISIONS.md "Integration test database").
 * `TQueryResult` is left generic (each driver has its own HKT) since
 * nothing here depends on the raw driver result shape — only on the
 * query-builder methods (`.select`, `.insert`, `.transaction`, ...),
 * which every PgDatabase subclass implements identically.
 */
export type Db =
  | PgDatabase<PgQueryResultHKT, typeof schema>
  | PgTransaction<PgQueryResultHKT, typeof schema>

let _sql: ReturnType<typeof postgres> | undefined
let _db: Db | undefined

export function getDb(): Db {
  if (!_db) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    _sql = postgres(url)
    _db = drizzle(_sql, { schema })
  }
  return _db
}
