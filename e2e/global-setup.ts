import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { sessions, users } from '../lib/db/schema'

/**
 * No real GitHub OAuth is available in CI, so authentication for e2e is
 * a direct database-session seed rather than driving the actual sign-in
 * flow.
 *
 * One user PER SPEC FILE (not one shared user): the event log
 * accumulates forever by design (it's append-only — CLAUDE.md principle
 * 1), so a shared user's data from an earlier spec/run is still there
 * when a later spec queries "the board" or "time travel to now",
 * confusing assertions that (reasonably) expect to see only their own
 * data. Isolating by user sidesteps that without ever needing to delete
 * anything.
 *
 * Upsert, never delete: `users` cascades to `events` on delete
 * (lib/db/schema.ts), and deleting a user with existing events would
 * cascade into an attempted DELETE on `events`, which the trigger
 * correctly rejects.
 */
// Every id is a valid UUID (hex only) — lib/events/envelope.ts validates
// actor_id with Zod's z.string().uuid(), and this id becomes actor_id on
// every event the client mints (lib/client/identity.ts getCachedUserId),
// so anything else would get silently rejected by the server as
// schema-invalid.
export const TEST_USERS = {
  offline: { id: '00000000-0000-4000-8000-000000000001', token: 'e2e-session-offline' },
  divergence: { id: '00000000-0000-4000-8000-000000000002', token: 'e2e-session-divergence' },
  timeTravel: { id: '00000000-0000-4000-8000-000000000003', token: 'e2e-session-time-travel' },
  themeContrast: { id: '00000000-0000-4000-8000-000000000004', token: 'e2e-session-theme-contrast' },
  accessibility: { id: '00000000-0000-4000-8000-000000000005', token: 'e2e-session-accessibility' },
  // Its own user, separate from `accessibility` above: this one is
  // asserted to be EMPTY, which only stays true forever (across repeated
  // suite runs) if nothing else ever creates data under it.
  accessibilityEmpty: { id: '00000000-0000-4000-8000-000000000006', token: 'e2e-session-accessibility-empty' },
} as const

export default async function globalSetup() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL must point at a real, migrated Postgres for e2e tests')

  const sql = postgres(url)
  const db = drizzle(sql, { schema: { users, sessions } })
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000)

  for (const { id, token } of Object.values(TEST_USERS)) {
    await db.insert(users).values({ id, name: 'E2E Test User', email: `${id}@example.com` }).onConflictDoNothing()
    await db
      .insert(sessions)
      .values({ sessionToken: token, userId: id, expires })
      .onConflictDoUpdate({ target: sessions.sessionToken, set: { expires } })
  }

  await sql.end()
}
