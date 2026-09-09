import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { getStateAt } from '@/lib/db/snapshots'
import { requireUserId } from '@/lib/auth/session'
import { apiError } from '@/lib/api/errors'

const SnapshotQuery = z.object({
  /** ISO instant. Omit for the current state. */
  at: z.string().datetime({ offset: true }).optional(),
})

/**
 * GET /snapshot?at=<timestamp> — time travel: state as of any instant,
 * keyed on server_timestamp (docs/DECISIONS.md "Time travel is over
 * server_timestamp, not client_timestamp"). Omitting `at` returns the
 * current state.
 */
export async function GET(request: NextRequest) {
  const userId = await requireUserId()
  if (!userId) return apiError('unauthorized', 'sign in required')

  const parsed = SnapshotQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.success) return apiError('validation_error', 'invalid query', parsed.error.flatten())

  const at = parsed.data.at ? new Date(parsed.data.at) : undefined
  const state = await getStateAt(getDb(), userId, at)
  return NextResponse.json({ at: parsed.data.at ?? null, state })
}
