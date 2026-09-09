import type { AnyEvent } from './schemas'
import { CURRENT_SCHEMA_VERSION } from './factory'

/**
 * Schema-version migration registry. The reducer (lib/domain/reducer.ts)
 * only ever sees current-version payloads; every event read from storage
 * or the wire passes through here first.
 *
 * Each migration is keyed by the version it upgrades FROM, and must return
 * an event one version higher. `upcast` applies migrations in sequence
 * until the event reaches CURRENT_SCHEMA_VERSION.
 *
 * Empty today (schema_version is 1 for every event type) — this is the
 * seam a future payload change hooks into instead of forking the reducer.
 */
type Migration = (event: AnyEvent) => AnyEvent

const MIGRATIONS: Record<number, Migration> = {}

export function upcast(event: AnyEvent): AnyEvent {
  let current = event
  while (current.schema_version < CURRENT_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[current.schema_version]
    if (!migrate) {
      throw new Error(
        `no migration registered from schema_version ${current.schema_version} ` +
          `(event ${current.id}, type ${current.type})`,
      )
    }
    current = migrate(current)
  }
  return current
}
