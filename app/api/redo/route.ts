import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { redo } from '@/lib/db/undo'
import { requireUserId } from '@/lib/auth/session'
import { apiError } from '@/lib/api/errors'

const RedoRequest = z.object({ device_id: z.string().uuid() })

/** POST /redo — mirror of POST /undo; see docs/DECISIONS.md "Undo/redo stack". */
export async function POST(request: NextRequest) {
  const userId = await requireUserId()
  if (!userId) return apiError('unauthorized', 'sign in required')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('validation_error', 'request body must be JSON')
  }
  const parsed = RedoRequest.safeParse(body)
  if (!parsed.success) return apiError('validation_error', 'invalid request', parsed.error.flatten())

  const result = await redo(getDb(), userId, parsed.data.device_id)
  if (!result) return apiError('not_found', 'nothing to redo')
  return NextResponse.json(result)
}
