import type { VectorClock } from '@/lib/events/envelope'
import { increment } from '@/lib/domain/vector-clock'
import { db } from './db'
import { getOrCreateDeviceId } from './identity'

async function getOrCreateSyncMeta() {
  const existing = await db.syncMeta.get('singleton')
  if (existing) return existing
  const fresh = { id: 'singleton' as const, deviceId: getOrCreateDeviceId(), sinceSeq: 0, clock: {} as VectorClock }
  await db.syncMeta.put(fresh)
  return fresh
}

/**
 * Bumps this device's own vector-clock component and persists the
 * result — called once per locally-minted event (lib/client/
 * mutations.ts), mirroring how a real device's clock only ever advances
 * on its own writes (lib/domain/vector-clock.ts `increment`).
 */
export async function nextLocalClock(): Promise<VectorClock> {
  const meta = await getOrCreateSyncMeta()
  const next = increment(meta.clock, meta.deviceId)
  await db.syncMeta.update('singleton', { clock: next })
  return next
}

export async function getLocalClock(): Promise<VectorClock> {
  return (await getOrCreateSyncMeta()).clock
}
