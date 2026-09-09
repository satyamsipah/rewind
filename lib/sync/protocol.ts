import { z } from 'zod'
import { VectorClock } from '@/lib/events/envelope'
import { AnyEvent } from '@/lib/events/schemas'

/**
 * Zod schemas for the POST /sync boundary (CLAUDE.md: "Zod schemas for
 * every API boundary"). See docs/DECISIONS.md "Sync protocol" for the
 * full request/response shape and the server algorithm.
 */

export const MAX_BATCH_SIZE = 500

export const SyncRequest = z.object({
  device_id: z.string().uuid(),
  /** Pull cursor: the highest user_seq this device has already received. */
  since_seq: z.number().int().nonnegative(),
  client_clock: VectorClock,
  events: z.array(z.unknown()).max(MAX_BATCH_SIZE),
  /** Only true when rebuilding a wiped/new client — otherwise the
   * device's own accepted events are omitted from the pull (it already
   * has them locally). */
  include_own: z.boolean().optional().default(false),
})
export type SyncRequestInput = z.input<typeof SyncRequest>
export type SyncRequestT = z.infer<typeof SyncRequest>

export const RejectedEvent = z.object({
  id: z.string(),
  reason: z.enum(['schema_invalid', 'actor_mismatch']),
})
export type RejectedEvent = z.infer<typeof RejectedEvent>

export const AcceptedEvent = z.object({
  id: z.string(),
  user_seq: z.number(),
  server_timestamp: z.string(),
})
export type AcceptedEvent = z.infer<typeof AcceptedEvent>

export const SyncResponse = z.object({
  accepted: z.array(AcceptedEvent),
  duplicates: z.array(z.string()),
  rejected: z.array(RejectedEvent),
  events: z.array(AnyEvent),
  server_clock: VectorClock,
  next_seq: z.number(),
  has_more: z.boolean(),
})
export type SyncResponseT = z.infer<typeof SyncResponse>

export const PULL_PAGE_SIZE = 500
