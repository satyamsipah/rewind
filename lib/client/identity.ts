/**
 * Device and user identity for locally-minted events. Mutations must work
 * fully offline (CLAUDE.md principle 3), so both ids have to be readable
 * synchronously from client-only storage — never re-fetched from the
 * network at write time.
 *
 * `device_id` is generated once and persists for the life of the browser
 * profile; it identifies this NODE for vector-clock purposes
 * (lib/domain/vector-clock.ts), not the person using it.
 *
 * `user_id` is cached from the Auth.js session the first time it
 * resolves (see components/providers/identity-provider.tsx) so that a
 * user who authenticated once can keep creating events indefinitely
 * offline, exactly as principle 3 requires.
 */
const DEVICE_ID_KEY = 'rewind:device_id'
const USER_ID_KEY = 'rewind:user_id'

export function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY)
  if (existing) return existing
  const id = crypto.randomUUID()
  localStorage.setItem(DEVICE_ID_KEY, id)
  return id
}

export function getCachedUserId(): string | null {
  return localStorage.getItem(USER_ID_KEY)
}

export function setCachedUserId(userId: string): void {
  localStorage.setItem(USER_ID_KEY, userId)
}
