import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '@/lib/db/schema'
import type { Db } from '@/lib/db/client'

/**
 * Real Postgres (compiled to WASM), in-process, per docs/DECISIONS.md
 * "Integration test database". Runs the actual migrations in ./drizzle —
 * including the hand-written append-only trigger — so the schema under
 * test is exactly the schema that ships, not a hand-rolled substitute.
 */
export async function createTestDb() {
  const client = new PGlite()
  const db = drizzle(client, { schema })

  const migrationsDir = join(process.cwd(), 'drizzle')
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const sqlText = readFileSync(join(migrationsDir, file), 'utf8')
    // Drizzle's own SQL files use `--> statement-breakpoint` to separate
    // statements that can't all run in one `exec` call (PGlite's exec()
    // runs a whole script, but DO blocks / multiple DDL statements are
    // safest split explicitly, matching how `drizzle-kit migrate` itself
    // replays these files).
    const statements = sqlText
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const statement of statements) {
      await client.exec(statement)
    }
  }

  return { client, db: db as unknown as Db }
}

export type TestDb = Db
