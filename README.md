# Rewind

An offline-first, event-sourced task platform. Every mutation is an
immutable event; current state is a projection derived from it. See
[CLAUDE.md](CLAUDE.md) for the full set of non-negotiable principles this
repo is built against, and [docs/DECISIONS.md](docs/DECISIONS.md) for the
reasoning behind every non-obvious choice below.

**Status:** backend spine only — event schema, reducer, Postgres log,
sync protocol, conflict resolution, undo/redo, and the API surface are
implemented and tested. There is no UI yet.

## Tech stack

Next.js 15 (App Router) + TypeScript strict · PostgreSQL + Drizzle ORM ·
Auth.js v5 (GitHub OAuth) · Dexie (client store, UI phase) · Server-Sent
Events · Vitest + PGlite (unit/integration) · Playwright (E2E, UI phase).
See [CLAUDE.md](CLAUDE.md) for the complete pinned stack.

## Architecture

### Event log (`lib/events/`)

15 event types, each a Zod schema in a discriminated union
([schemas.ts](lib/events/schemas.ts)): `TaskCreated`, `TaskRenamed`,
`TaskCompleted`, `TaskUncompleted`, `TaskDeleted`, `TaskRestored`,
`TaskMoved`, `TaskDueDateSet`, `TaskPriorityChanged`, `TagAdded`,
`TagRemoved`, `ListCreated`, `ListRenamed`, `ListArchived`,
`NoteAttached`. Every event carries the envelope in
[envelope.ts](lib/events/envelope.ts): `id` (UUIDv7), `actor_id`,
`device_id`, `entity_id`, `entity_type`, `type`, `payload`,
`client_timestamp`, `server_timestamp`, `vector_clock`,
`schema_version`.

### Domain (`lib/domain/`)

`reduce(events) => AppState` ([reducer.ts](lib/domain/reducer.ts)) is a
pure function — no `Date.now()`, no randomness, no I/O, enforced by a
static check ([no-impurity.test.ts](lib/domain/no-impurity.test.ts)) and
an ESLint rule. Conflict resolution ([merge.ts](lib/domain/merge.ts)) is
operation-based merge with an LWW-register default; `inverse.ts` computes
undo's compensating event; `canonical.ts` gives deterministic
serialisation; `resume.ts` reconstructs a snapshot into synthetic events
for the "snapshot + delta" resume path.

### Database (`lib/db/`, `drizzle/`)

Postgres via Drizzle. `events` is append-only — enforced by a
hand-written trigger migration
([0001_append_only_and_indexes.sql](drizzle/0001_append_only_and_indexes.sql))
that rejects UPDATE/DELETE/TRUNCATE, plus a `REVOKE` as defence in depth.
`user_seq` (not a DB sequence, not `server_timestamp`) is the sync
cursor — see [docs/DECISIONS.md](docs/DECISIONS.md) for why. `snapshots`
and `projections` are derived caches, never a source of truth.

### Sync protocol (`lib/sync/`, `app/api/sync/`)

`POST /sync` pushes a batch of local events and pulls everything the
device hasn't seen, in one round trip and one transaction
([server.ts](lib/sync/server.ts)). Idempotent by dedupe-on-id; a batch
with any invalid event is rejected atomically. `GET /sync/stream` is SSE
carrying a lightweight nudge, not event bodies. `lib/sync/client.ts` is a
transport-agnostic client engine (outbox + cursor ports) — the same code
that will eventually run against Dexie in the browser is exercised in
tests today via an in-memory adapter
([in-memory-adapter.ts](lib/sync/in-memory-adapter.ts)).

### API (`app/api/`)

| Route | Purpose |
| --- | --- |
| `POST /api/sync` | push + pull, per the sync protocol |
| `GET /api/sync/stream` | SSE live-update nudges |
| `GET /api/history` | activity timeline, filterable, keyset-paginated |
| `GET /api/snapshot?at=` | time travel — state as of any instant |
| `POST /api/undo` / `POST /api/redo` | per-device undo/redo stack |
| `/api/auth/[...nextauth]` | Auth.js v5 (GitHub OAuth) |

Every route validates with Zod and returns a typed `{ error: { code,
message, details? } }` envelope on failure ([lib/api/errors.ts](lib/api/errors.ts)).

## Development

```bash
pnpm install
cp .env.example .env   # fill in DATABASE_URL, AUTH_SECRET, AUTH_GITHUB_*
pnpm db:generate        # drizzle-kit generate, after a schema.ts change
pnpm db:migrate         # apply drizzle/*.sql to DATABASE_URL
pnpm dev
```

## Testing

```bash
pnpm typecheck
pnpm test               # unit (pure lib/) + integration (PGlite) projects
pnpm test:unit
pnpm test:integration
pnpm lint
```

Integration tests run against **PGlite** (real Postgres, compiled to
WASM, in-process) — no Docker, no external service, and the actual
`drizzle/` migrations run for real, so the append-only trigger is
exercised as shipped. See
[docs/DECISIONS.md](docs/DECISIONS.md#testing-pglite-over-testcontainers-playwright-deferred).

Coverage highlights: every event type round-trips (apply → inverse →
original state); the reducer is order-independent (property-tested with
`fast-check`); two-device offline divergence is tested at the domain
layer, the sync-server layer, and through the real client engine; time
travel and snapshot-vs-full-replay are asserted byte-for-byte; the
append-only trigger and cross-user isolation are tested against a real
Postgres engine.

## What's not here yet

- **UI** — no Next.js pages, no Tailwind/shadcn/Framer/Zustand/TanStack,
  no Dexie-backed IndexedDB store. `lib/sync/client.ts` is ready for a
  Dexie adapter to plug into the same ports the in-memory test adapter
  uses.
- **Playwright / genuine offline E2E** — deferred until there's a UI to
  drive (`.claude/rules/testing.md` requires `context.setOffline(true)`,
  which needs a real page).
- **`eslint-config-next`** — deferred until there are components/pages
  for its React/JSX rules to apply to.
