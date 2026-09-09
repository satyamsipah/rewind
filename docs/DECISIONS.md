# Architecture Decision Log

## Event-sourced backend + sync protocol (no UI)

Scope: the event schema, the pure reducer, the Postgres event log, the
sync protocol, conflict resolution, undo/redo, the API surface, and
Auth.js — everything CLAUDE.md's non-negotiables require, with no UI yet.

### Event envelope: UUIDv7, and two approved extensions

Event ids are UUIDv7, not v4: `events.id` is the primary key of a table
that only ever grows, so v4's uniformly-random inserts would scatter
across the B-tree (cache misses, page splits, bloat that worsens with
size) where v7's timestamp prefix appends to the right edge — the same
locality a `bigserial` gives, while staying **client-mintable offline**
like v4 (the client mints the id before the event has ever seen a
network, which is exactly what makes the dedupe-by-id sync idempotent).
The embedded timestamp is deliberately never trusted for ordering across
devices — it's an untrusted client clock; causality is the vector clock,
settled order is `user_seq` (see below). Full rationale is a comment on
`UuidV7` in [lib/events/envelope.ts](../lib/events/envelope.ts).

CLAUDE.md principle 2 names nine envelope fields. Two were added, approved
during design review:

- **`device_id`** — the vector clock is keyed by device, and once two
  devices' clocks have been merged, the authoring device is no longer
  reliably derivable from the clock alone. Needed for per-device
  `sync_state` and for attributing undo-stack entries to the right
  device.
- **`entity_type`** — avoids parsing the `type` string to know whether an
  event is about a task or a list; used directly in SQL (`events.entity_type`,
  the projections composite key).

### Event schema shape

Two decisions apply across all 15 event types
([lib/events/schemas.ts](../lib/events/schemas.ts)):

- **Value-replacing events carry `{ from, to }`.** This makes
  `inverse(event)` ([lib/domain/inverse.ts](../lib/domain/inverse.ts)) a
  pure function of the event alone — no lookup into prior state needed —
  and gives field-level merge a cheap "what did this write" handle. It's
  also why `ListArchived` and `NoteAttached` are set-events rather than
  needing separate unarchive/detach types, keeping the union at exactly
  the 15 given types.
- **`TaskMoved` groups `list_id` and `position` as one atomic pair.** If
  they merged as independent fields, a concurrent move could land a task
  in one device's list at another device's position. Same reasoning
  applies to `completed`/`completed_at` as a pair.

**Positions are fractional-index strings**, not integers, so a concurrent
insert between the same two neighbours never needs a renumbering pass.

**Round-trip subtlety:** `inverse(TaskCreated)` is `TaskDeleted`, and
`inverse(ListCreated)` is `ListArchived{true}` (there's no `ListDeleted`
type in the given 15) — append-only means both are *soft* tombstones, not
a true absence. The round-trip test
([lib/domain/round-trip.test.ts](../lib/domain/round-trip.test.ts))
therefore asserts on `observable(state)` (tombstones/archived hidden) for
every type, plus a narrower raw-state assertion for these two specifically
that the only difference from "never existed" is the tombstone flag.

### Reducer: full replay + frontier resolution, not incremental fold

`reduce(events) => AppState`
([lib/domain/reducer.ts](../lib/domain/reducer.ts)) does not apply events
one at a time in array order. For each field, it collects **every** write
that field ever received across the whole input and resolves them once
via the "maximal frontier" (writes not causally dominated by another) plus
a deterministic tiebreak
([lib/domain/merge.ts](../lib/domain/merge.ts)). That resolution is a
pure function of the write **set**, not of arrival order — which is what
makes `reduce()` provably order-independent (see the `fast-check`
property test in
[lib/domain/reducer.property.test.ts](../lib/domain/reducer.property.test.ts))
and is the mechanism the divergence tests rely on.

`REDUCER_VERSION` is bumped whenever this field logic changes in a way
that could change resolved output for existing events; snapshots record
it and a mismatched snapshot is never resumed from (see below).

### Conflict resolution: operation-based merge, LWW-Register default

**Chosen: operation-based merge with LWW-Register as the default field
type.** Every field gets a merge strategy from
[lib/domain/merge.ts](../lib/domain/merge.ts); most just inherit
`resolveField` (an LWW-register: causally-latest write wins, concurrent
writes broken by `(client_timestamp, device_id, event_id)`, a total
order). Two fields opt out because their operation carries intent a
plain register can't express:

- **`tags`** — `resolveBiasedBoolean(..., biasValue: true)` per distinct
  tag key, add-biased. Two concurrent `TagAdded` calls touch different
  keys and both survive; a concurrent `TagAdded`/`TagRemoved` on the same
  tag resolves add-wins.
- **`deleted`** — `resolveBiasedBoolean(..., biasValue: false)`,
  restore-biased: concurrent delete/restore never silently loses data. A
  restore that causally *follows* a delete still resolves by clock
  dominance — the bias only fires on genuine concurrency.

**Rejected: uniform field-level LWW everywhere.** Simpler (one code path,
every new field/event type gets a rule for free), but `tags` would be a
single field under that scheme, so two concurrent `TagAdded` calls would
have one whole-array write beat the other — a real, silent loss of user
data for a task app. The chosen approach keeps LWW's simplicity for the
~90% of fields that are genuinely scalar, and only pays for something
smarter where data loss is the alternative.

Full merge table (● = clean/no rule needed, the fields are simply
independent; a named strategy = these tests in
[lib/domain/divergence.test.ts](../lib/domain/divergence.test.ts) and
[test/integration/divergence.test.ts](../test/integration/divergence.test.ts)):

| Concurrent pair | Resolution |
| --- | --- |
| Rename ∥ due-date-set | ● independent fields, both apply |
| Rename ∥ complete | ● independent fields, both apply |
| Delete ∥ Rename | ● independent fields — both apply (tombstoned *and* renamed; a later restore surfaces the new title) |
| `TagAdded(x)` ∥ `TagAdded(y)` | `LwwElementSet`, add-biased per key — both tags survive |
| `TagAdded(x)` ∥ `TagRemoved(x)` | `LwwElementSet`, add-biased — add wins |
| Rename ∥ Rename | `LwwRegister` tiebreak — deterministic, same winner regardless of sync order |
| Complete ∥ Uncomplete | `LwwRegister` tiebreak over the pair |
| Delete ∥ Restore | `RestoreWins` — restore wins on genuine concurrency |
| Move ∥ Move | `LwwRegister` over the atomic `{list_id, position}` pair — never a mix of one move's list with another's position |
| Create ∥ Create | impossible — entity ids are client-minted UUIDs, never collide |

### Sync protocol

`POST /sync` pushes and pulls in one round trip
([lib/sync/protocol.ts](../lib/sync/protocol.ts),
[lib/sync/server.ts](../lib/sync/server.ts)).

**Why `user_seq`, not a timestamp cursor.** `now()` is not commit-ordered:
a transaction can take timestamp *t₁* and another take *t₂ > t₁* but
commit first. A client polling `WHERE server_timestamp > t₂` in that
window would never see the *t₁* event once it does commit. A plain
`bigserial` has the identical flaw (allocated pre-commit). So
[lib/db/sequence.ts](../lib/db/sequence.ts) allocates `user_seq` via a
per-user upsert that takes a row lock (`INSERT ... ON CONFLICT DO
UPDATE`), serialising appends and making `user_seq` gapless and safe as a
cursor. `server_timestamp` remains for display and time travel, which
query a settled past rather than a moving edge.

**A batch with any invalid event is rejected atomically**, not
partially — a partial accept could leave a causal hole. The client is
expected to quarantine the named ids and retry without them (see
`SyncRejectedError` in [lib/sync/client.ts](../lib/sync/client.ts)).

**SSE fanout is a poll inside the handler**
([app/api/sync/stream/route.ts](../app/api/sync/stream/route.ts)), not
Postgres `LISTEN/NOTIFY`. Rejected `LISTEN/NOTIFY`: sub-100ms latency and
no polling load, but it pins a dedicated PG connection per open stream,
awkward against a pooled connection (Neon on Vercel). The ~1s-latency
poll needs no extra infrastructure and behaves identically on serverless
and single-node; the upgrade path is a single function swap. The stream
emits a **nudge** (`{user_seq, count}`), never event bodies, keeping
`POST /sync` the single ordered ingress.

**Time travel is over `server_timestamp`, not `client_timestamp`**
([lib/db/snapshots.ts](../lib/db/snapshots.ts) `getStateAt`) — "state as
the server knew it at instant T". An event authored offline at T-1h but
synced at T+1h is excluded from a query at T. The alternative makes
recorded history mutate retroactively every time an old device
reconnects.

### Snapshot cadence: every 200 events, keep 3

[lib/db/snapshots.ts](../lib/db/snapshots.ts) snapshots every 200 events
per user, retaining the newest 3. Rejected: **time-based cadence** —
bounds storage but leaves worst-case replay unbounded for a heavy user;
**write-on-read** — self-tuning, but puts a write in the read path, which
is hostile to read replicas and to a request that should be pure. Count-
based bounds worst-case replay at 200 events, is deterministic, and costs
nothing for an idle user. Keeping 3 lets a snapshot from an incompatible
`reducer_version` (or a corrupt one) be skipped in favour of the next-
older one instead of falling all the way back to a full replay.

### Snapshot resume: a documented limitation

Creating a snapshot is always exactly correct — it's a full `reduce()`
over a real, complete event prefix. **Resuming** from one
(`getStateAt`'s snapshot+delta path) reconstructs a small synthetic event
per resolved field ([lib/domain/resume.ts](../lib/domain/resume.ts)), all
carrying the snapshot's own aggregate vector clock, and lets `reduce()`
merge those against the real delta. This is the standard "single winner
per field" LWW-register simplification: it is exact for any delta that
doesn't have a genuinely 3-way-or-more unsynced concurrent history on the
*same field* straddling the snapshot boundary. Real snapshot cadence
(every 200 events) makes that vanishingly unlikely in practice, and it's
the same simplification most production LWW-register CRDTs make.
[lib/db/projections.ts](../lib/db/projections.ts) avoids this limitation
entirely — a single entity's full history is cheap enough to replay in
full every time, so its cache is always exactly a full replay, just
scoped to one entity. A whole-user snapshot cannot afford that, which is
why the two caches use different strategies.

### Undo/redo stack

`undo_entries` ([lib/db/schema.ts](../lib/db/schema.ts),
[lib/db/undo.ts](../lib/db/undo.ts)) is **not** part of the immutable
event log — CLAUDE.md principle 1 constrains `events`, not internal
bookkeeping — and is mutated in place as a 3-state machine per entry:
`active` (undoable) → `undone` (redoable) → `superseded` (a new real
action pushed it out of the redo stack, standard undo/redo UX). The
compensating event itself is always a normal event appended through the
exact same path as any user action — undo never rewrites history.

The stack is scoped **per (user_id, device_id)**: a device undoes only
its own most recent action, never another device's. Undoing a
concurrently-editing device's change from across the room is a confusing
UX this scope doesn't attempt to solve.

### Auth: Auth.js v5, database sessions, session-derived identity only

[lib/auth/config.ts](../lib/auth/config.ts) uses `@auth/drizzle-adapter`
with **database sessions** (not JWT), so a session can be revoked
server-side. Every API route resolves `actor_id`/`user_id` from
`auth()` ([lib/auth/session.ts](../lib/auth/session.ts)) — there is no
code path that accepts a user id from a request body or header. Tested
directly at the `syncPush` layer (bypassing HTTP) in
[test/integration/sync.test.ts](../test/integration/sync.test.ts) ("auth
isolation") and structurally in `syncPush` itself, which rejects any
event whose `actor_id` doesn't match the authenticated session.

### Testing: PGlite over testcontainers; Playwright deferred

Integration tests run on **PGlite** (real Postgres compiled to WASM,
in-process) rather than testcontainers against a real server: it runs the
actual `drizzle/` migrations — including the append-only trigger and
`FOR UPDATE`-equivalent locking — starts in milliseconds, and needs no
Docker daemon in CI. Rejected testcontainers for the Docker dependency it
adds to every dev/CI run, in exchange for extension-behaviour parity this
project doesn't need.

**Playwright is deferred, not skipped.**
[.claude/rules/testing.md](../.claude/rules/testing.md) requires a
genuinely offline `context.setOffline(true)` E2E test, which needs a UI
that doesn't exist yet in this phase. It's explicitly scoped to the UI
phase.

### ESLint: minimal flat config for now, `eslint-config-next` later

[eslint.config.mjs](../eslint.config.mjs) is TypeScript-correctness plus
one project rule (`lib/domain/**` may not reference `Date` or
`Math.random`, per `.claude/rules/domain.md`). There are no
components/pages yet, so full `eslint-config-next` integration (with its
React/JSX/accessibility rules) is deferred to the UI phase rather than
configured against code that doesn't exist yet.
