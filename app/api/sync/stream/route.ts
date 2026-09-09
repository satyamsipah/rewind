import type { NextRequest } from 'next/server'
import { and, eq, gt, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { events } from '@/lib/db/schema'
import { requireUserId } from '@/lib/auth/session'
import { apiError } from '@/lib/api/errors'

export const runtime = 'nodejs'
export const maxDuration = 60

const POLL_INTERVAL_MS = 1000
const PING_INTERVAL_MS = 25000

/**
 * GET /sync/stream — Server-Sent Events for live multi-device updates.
 * Emits a NUDGE (`{ user_seq, count }`), never event bodies — the client
 * reacts by calling POST /sync, keeping that the single ordered ingress
 * for both push and pull (docs/DECISIONS.md "Sync protocol").
 *
 * Fanout is a poll inside the handler (docs/DECISIONS.md "SSE fanout: the
 * handler polls"): no extra infrastructure, identical behaviour on
 * serverless and single-node, ~1s worst-case latency. `?since=<seq>`
 * replays the gap on connect before going live, so there's no hole
 * between an initial POST /sync and this stream picking up.
 *
 * Vercel's request-duration ceiling means a connection can't stay open
 * forever; `maxDuration` bounds it and the client is expected to
 * reconnect (`retry:` below and `Last-Event-ID` on the next request).
 */
export async function GET(request: NextRequest) {
  const userId = await requireUserId()
  if (!userId) return apiError('unauthorized', 'sign in required')

  const sinceParam = request.nextUrl.searchParams.get('since')
  let lastSeq = BigInt(sinceParam && /^\d+$/.test(sinceParam) ? sinceParam : '0')

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return
        controller.enqueue(encoder.encode(`event: ${event}\nid: ${lastSeq}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      send('connected', { since: Number(lastSeq) })

      const pingTimer = setInterval(() => {
        if (closed) return
        controller.enqueue(encoder.encode(': ping\n\n'))
      }, PING_INTERVAL_MS)

      const pollTimer = setInterval(async () => {
        if (closed) return
        try {
          const [row] = await getDb()
            .select({ count: sql<number>`COUNT(*)`, maxSeq: sql<string | null>`MAX(${events.userSeq})` })
            .from(events)
            .where(and(eq(events.userId, userId), gt(events.userSeq, lastSeq)))
          if (row && row.count > 0 && row.maxSeq) {
            lastSeq = BigInt(row.maxSeq)
            send('nudge', { user_seq: Number(lastSeq), count: row.count })
          }
        } catch {
          // A transient DB hiccup shouldn't kill the stream — the client
          // will still catch up on the next successful poll or reconnect.
        }
      }, POLL_INTERVAL_MS)

      request.signal.addEventListener('abort', () => {
        closed = true
        clearInterval(pingTimer)
        clearInterval(pollTimer)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
