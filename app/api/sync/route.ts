import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { requireUserId } from '@/lib/auth/session'
import { apiError } from '@/lib/api/errors'
import { SyncRequest } from '@/lib/sync/protocol'
import { syncPush } from '@/lib/sync/server'

/**
 * POST /sync — push local events, pull everything new. See
 * docs/DECISIONS.md "Sync protocol" for the full request/response shape
 * and server algorithm (lib/sync/server.ts does the actual work; this
 * route is deliberately thin — CLAUDE.md "No business logic in
 * components" applies equally to routes).
 */
export async function POST(request: NextRequest) {
  const userId = await requireUserId()
  if (!userId) return apiError('unauthorized', 'sign in required')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('validation_error', 'request body must be JSON')
  }

  const parsed = SyncRequest.safeParse(body)
  if (!parsed.success) {
    return apiError('validation_error', 'invalid sync request', parsed.error.flatten())
  }

  const result = await syncPush(getDb(), userId, parsed.data)
  if (result.rejected.length > 0) {
    return NextResponse.json(result, { status: 422 })
  }
  return NextResponse.json(result)
}
