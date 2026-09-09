import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { events } from '@/lib/db/schema'
import { rowToEvent } from '@/lib/db/mappers'
import { describe } from '@/lib/domain/describe'
import { EVENT_TYPES } from '@/lib/events/schemas'
import { requireUserId } from '@/lib/auth/session'
import { apiError } from '@/lib/api/errors'

const HistoryQuery = z.object({
  entity_id: z.string().uuid().optional(),
  type: z.enum(EVENT_TYPES as [string, ...string[]]).optional(),
  actor_id: z.string().uuid().optional(),
  before_seq: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/**
 * GET /history — activity timeline, newest first, keyset-paginated on
 * user_seq (the (user_id, type, server_timestamp) and (user_id,
 * server_timestamp) indexes — drizzle/0001 — are what make the type and
 * plain-recency filters cheap).
 */
export async function GET(request: NextRequest) {
  const userId = await requireUserId()
  if (!userId) return apiError('unauthorized', 'sign in required')

  const parsed = HistoryQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams))
  if (!parsed.success) return apiError('validation_error', 'invalid query', parsed.error.flatten())
  const query = parsed.data

  const conditions = [eq(events.userId, userId)]
  if (query.entity_id) conditions.push(eq(events.entityId, query.entity_id))
  if (query.type) conditions.push(eq(events.type, query.type))
  if (query.actor_id) conditions.push(eq(events.actorId, query.actor_id))
  if (query.before_seq) conditions.push(lt(events.userSeq, BigInt(query.before_seq)))

  const rows = await getDb()
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(desc(events.userSeq))
    .limit(query.limit)

  const items = rows.map((row) => {
    const event = rowToEvent(row)
    return { event, user_seq: Number(row.userSeq), description: describe(event) }
  })

  return NextResponse.json({
    items,
    next_before_seq: rows.length === query.limit ? Number(rows[rows.length - 1]!.userSeq) : null,
  })
}
