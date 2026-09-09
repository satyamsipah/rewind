# Rewind

An offline-first, event-sourced task platform. Every mutation is an
immutable event; current state is a projection derived from it. See
[CLAUDE.md](CLAUDE.md) for the full set of non-negotiable principles this
repo is built against, and [docs/DECISIONS.md](docs/DECISIONS.md) for the
reasoning behind every non-obvious choice below.

**Status:** feature-complete offline-first client on top of the event-
sourced backend — local Dexie store, background sync engine, the task
board (lists, subtasks, drag-and-drop reorder, due dates, priorities,
tags, notes), full history (activity timeline, per-task lifecycle, time
travel), client-owned undo/redo, a token-based theme system with a
WCAG-AA-validated custom theme editor, a command palette, and an
installable offline-capable PWA. See
[docs/DECISIONS.md](docs/DECISIONS.md#what-s-deferred) for the short list
of what's still thinner than ideal.

## Tech stack

Next.js 15 (App Router) + TypeScript strict · PostgreSQL + Drizzle ORM ·
Auth.js v5 (GitHub OAuth) · Dexie (IndexedDB) · Server-Sent Events ·
Tailwind v4 + shadcn/ui-style primitives + Framer Motion · Zustand
(client UI state) + TanStack Query (server state) · Vitest + PGlite
(unit/client/integration) · Playwright + axe-core (E2E). See
[CLAUDE.md](CLAUDE.md) for the complete pinned stack.

## Architecture

### Event log (`lib/events/`)

16 event types, each a Zod schema in a discriminated union
([schemas.ts](lib/events/schemas.ts)): the original 15 (`TaskCreated`,
`TaskRenamed`, `TaskCompleted`, `TaskUncompleted`, `TaskDeleted`,
`TaskRestored`, `TaskMoved`, `TaskDueDateSet`, `TaskPriorityChanged`,
`TagAdded`, `TagRemoved`, `ListCreated`, `ListRenamed`, `ListArchived`,
`NoteAttached`) plus `PreferenceSet` for user preferences (theme, and any
future one, without another schema change). Every event carries the
envelope in [envelope.ts](lib/events/envelope.ts): `id` (UUIDv7),
`actor_id`, `device_id`, `entity_id`, `entity_type`, `type`, `payload`,
`client_timestamp`, `server_timestamp`, `vector_clock`,
`schema_version`. `TaskCreated`/`TaskMoved` also carry an optional
`parent_task_id` for subtasks.

### Domain (`lib/domain/`)

`reduce(events) => AppState` ([reducer.ts](lib/domain/reducer.ts)) is a
pure function — no `Date.now()`, no randomness, no I/O, enforced by a
static check ([no-impurity.test.ts](lib/domain/no-impurity.test.ts)) and
an ESLint rule — and isomorphic: the exact same code runs server-side
(projections, snapshots) and client-side
([lib/client/projection.ts](lib/client/projection.ts)), so the two can
never disagree about what a task looks like. Conflict resolution
([merge.ts](lib/domain/merge.ts)) is operation-based merge with an
LWW-register default; `inverse.ts` computes undo's compensating event;
`canonical.ts` gives deterministic serialisation; `resume.ts`
reconstructs a snapshot into synthetic events for the "snapshot + delta"
resume path.

### Database (`lib/db/`, `drizzle/`)

Postgres via Drizzle. `events` is append-only — enforced by a
hand-written trigger migration
([0001_append_only_and_indexes.sql](drizzle/0001_append_only_and_indexes.sql))
that rejects UPDATE/DELETE/TRUNCATE, plus a `REVOKE` as defence in depth.
`user_seq` (not a DB sequence, not `server_timestamp`) is the sync
cursor — see [docs/DECISIONS.md](docs/DECISIONS.md) for why. `snapshots`
and `projections` are derived caches, never a source of truth.

### Client (`lib/client/`)

The local, offline-first half of the same architecture. Every mutation
([lib/client/mutations.ts](lib/client/mutations.ts)) writes to Dexie
first — event log, outbox, and projection, in one transaction — before
any network call exists (CLAUDE.md principle 3). Reads for the UI
([lib/client/hooks.ts](lib/client/hooks.ts)) are `dexie-react-hooks` live
queries over the projection: instant, reactive, no network involved.
[lib/client/sync-engine.ts](lib/client/sync-engine.ts) drains the outbox
on reconnect/mutation/focus/SSE-nudge/a 30s fallback, with exponential
full-jitter backoff and a visible `offline | syncing | synced | error |
signed_out` status. [lib/client/undo.ts](lib/client/undo.ts) is a
client-owned undo/redo stack — mirrors the server's 3-state machine but
works with zero round trips, which offline undo/redo requires. See
[docs/DECISIONS.md](docs/DECISIONS.md#client-sync-architecture) for the
full design and two real bugs manual testing found in it.

### Theme (`lib/theme/`, `app/globals.css`)

Every colour, spacing value, radius, and font size is a CSS custom
property ([app/globals.css](app/globals.css)), authored in `oklch()`
function notation, never hex. Mode (light/dark/system) and accent
(default/violet/amber/custom) are independent axes.
[lib/theme/palette.ts](lib/theme/palette.ts) derives a full light+dark
palette from one base colour and validates real WCAG AA contrast on
every rendered pair, auto-correcting (never hard-rejecting first) a
failing one. [scripts/check-no-hex.mjs](scripts/check-no-hex.mjs), run in
`pnpm lint`, fails the build if a hex colour appears anywhere in
`app/`, `components/`, or `lib/`.

### Sync protocol (`lib/sync/`, `app/api/sync/`)

`POST /sync` pushes a batch of local events and pulls everything the
device hasn't seen, in one round trip and one transaction
([server.ts](lib/sync/server.ts)). Idempotent by dedupe-on-id; a batch
with any invalid event is rejected atomically. `GET /sync/stream` is SSE
carrying a lightweight nudge, not event bodies.
[lib/sync/client.ts](lib/sync/client.ts) is the transport-agnostic client
engine (outbox + cursor ports) that [lib/client/sync-adapter.ts](lib/client/sync-adapter.ts)
implements against Dexie + `fetch` — the same engine is exercised in
tests via an in-memory adapter
([in-memory-adapter.ts](lib/sync/in-memory-adapter.ts)).

### UI (`app/`, `components/`)

`app/page.tsx` is a static Server Component; `components/app-shell.tsx`
decides sign-in vs. board client-side, which is what keeps the route
precache-able for the PWA service worker
([docs/DECISIONS.md](docs/DECISIONS.md#pwa-a-hand-written-service-worker-not-a-build-plugin)).
`components/board/` is the task UI — a `dnd-kit` sortable list (one
`TaskMoved` event per drop, never a renumbering pass), an expandable
per-task detail panel, filters, and search, all over the local
projection. `components/history/` is the activity timeline, per-task
lifecycle, and a read-only time-travel view, all reading only the local
event log so History works fully offline too.
`components/theme/theme-editor-dialog.tsx` is the custom theme editor.
`components/command-palette.tsx` (`cmdk`) and
[lib/client/shortcuts.ts](lib/client/shortcuts.ts) cover create/search/
navigate/switch-theme/jump-to-history, each call routed through the same
mutation/theme functions any other surface uses.

### PWA (`public/sw.js`, `app/manifest.ts`)

A hand-written service worker precaches the app shell (stale-while-
revalidate) and never intercepts `/api/*` — sync always hits the real
network or fails fast, never a stale response pretending to be live
data. Verified by stopping the server entirely and reloading: the full
shell (including the persisted theme) still renders with the network
genuinely off.

### API (`app/api/`)

| Route | Purpose |
| --- | --- |
| `POST /api/sync` | push + pull, per the sync protocol |
| `GET /api/sync/stream` | SSE live-update nudges |
| `GET /api/history` | activity timeline, filterable, keyset-paginated |
| `GET /api/snapshot?at=` | time travel — state as of any instant |
| `POST /api/undo` / `POST /api/redo` | per-device undo/redo stack (legacy path — the UI uses the client-owned stack) |
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
pnpm test               # unit + client + integration Vitest projects
pnpm test:unit          # pure lib/events, lib/domain, lib/theme, lib/shared
pnpm test:client        # lib/client (Dexie, jsdom + fake-indexeddb)
pnpm test:integration   # lib/db, lib/sync (PGlite)
pnpm test:e2e           # Playwright — needs a real, migrated Postgres (see below)
pnpm lint               # ESLint + scripts/check-no-hex.mjs
```

Integration tests run against **PGlite** (real Postgres, compiled to
WASM, in-process) — no Docker, no external service, and the actual
`drizzle/` migrations run for real, so the append-only trigger is
exercised as shipped.

**E2E tests need a real, reachable Postgres** (PGlite is in-process and
can't be reached by a separately-launched Next.js server):
`DATABASE_URL` must point at one, migrated (`pnpm db:migrate`), before
running `pnpm test:e2e`. There's no real GitHub OAuth in CI, so
[e2e/global-setup.ts](e2e/global-setup.ts) seeds database sessions
directly rather than driving the sign-in flow. Playwright builds and
runs a **production** server, not `next dev` — dev mode's per-session
asset URLs make service-worker caching unreliable, and Fast Refresh can
reload a page mid-test.

Coverage highlights: every event type round-trips (apply → inverse →
original state); the reducer is order-independent (property-tested with
`fast-check`); two-device offline divergence is tested at the domain
layer, the sync-server layer, through the real client engine
(Vitest), and through two real browser contexts genuinely going offline
(Playwright); time travel and snapshot-vs-full-replay are asserted
byte-for-byte at both the server and client layers; the append-only
trigger and cross-user isolation are tested against a real Postgres
engine; every built-in theme × mode combination passes a real
`color-contrast` axe scan; six main views pass an axe scan with zero
critical violations; and the PWA shell is verified to load with the
server stopped entirely.

## What's not here yet

See [docs/DECISIONS.md](docs/DECISIONS.md#what-s-deferred) — in short:
cross-list drag-and-drop (same-list reorder is implemented), a full
maskable-icon PNG set for the PWA manifest (currently one SVG), and an
APCA-based contrast upgrade path beyond the WCAG 2.x AA this ships with.
