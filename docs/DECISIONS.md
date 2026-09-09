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

## Offline-first client, theming, history, PWA

Scope: a client that works fully offline and makes the event log visible
and useful — the Dexie local store, the sync engine, the task UI,
history/time-travel, undo/redo moved client-side, the theme token system
and custom theme editor, the command palette, and a PWA shell. Design
review for the sync engine and theme architecture happened before any
code was written; three forks were decided explicitly rather than picked
silently (all three matched the recommendation given):

- **Tailwind v4**, not v3 — `@theme` lives in the same CSS file as the
  token definitions themselves (app/globals.css), so there's one source
  of truth for "a token system, not a class toggle" instead of a CSS file
  and a JS config kept in sync by hand.
- **Undo/redo moved client-side** — see below.
- **A generic `PreferenceSet` event**, not a dedicated `ThemeChanged` type
  — see below.

### Client sync architecture

[lib/client/db.ts](../lib/client/db.ts) keeps the full local event log
(`events`), not just a projection — History and time travel need to work
offline too (item 4), which isn't possible from a projection alone. A
small `outbox` queue table (not a `pending` flag on `events`) tracks
what's unsynced: a separate table stays tiny regardless of how large the
full log grows, and keeps `getPending()` a cheap read instead of an
indexed scan over the whole history. `tasks`/`lists`/`preferences` are
the live projection, kept current the same way
[lib/db/projections.ts](../lib/db/projections.ts) does server-side: on
any new event, replay just that entity's local slice through the shared
`reduce()` and upsert — one reducer implementation, isomorphic, so client
and server can never disagree about what a task looks like.

**Trigger strategy** ([lib/client/sync-engine.ts](../lib/client/sync-engine.ts)):
debounced ~300ms after a local mutation, immediately on `window.online`,
on tab focus (`visibilitychange`), on an SSE nudge, plus a 30s fallback
interval. Backoff is exponential with **full jitter**
(`random(0, min(cap, base·2ⁿ))`) rather than a fixed-floor jitter — it
spreads retries across the whole window instead of clustering near a
floor, which is what actually prevents many clients from retrying in
lockstep after a shared outage.

**Status is `offline | syncing | synced | error | signed_out`** —
deliberately no sticky "conflict" state. Principle 5 means a conflict
always auto-resolves; there is never a decision left for a person to
make. What that state would have shown instead is a transient, non-
blocking toast ("merged 2 changes from another device") whenever a
pulled remote event touches an entity with a pending local edit — see
`useMergeToasts` in
[components/providers/providers.tsx](../components/providers/providers.tsx).
A 401/403 flips straight to `signed_out` with no backoff (retrying a dead
session forever would never succeed); a 422 (`batch_rejected`) doesn't
back off either — the bad ids are quarantined and the rest of the batch
retries at normal cadence.

**Resume-on-startup needs no "was a request in flight" journal.**
Idempotent dedupe-by-id (principle 4) means a non-empty outbox on launch
is always safe to just resend. Getting this right surfaced a real bug:
`runSyncCycle` was only clearing the outbox for ids the server returned
in `accepted`, never `duplicates` — so a batch the server committed, but
whose accept response never reached the client (the literal "app closed
mid-sync" case), would resend forever as an all-`duplicates` batch that
never got cleared. Fixed to treat both as confirmed
([lib/sync/client.ts](../lib/sync/client.ts)), with a regression test
([test/unit/sync-client.test.ts](../test/unit/sync-client.test.ts)).

A second real bug surfaced by testing, not design review:
`subscribeSyncStatus` used to invoke its listener synchronously the
moment something subscribed (so a caller could "get the current value
immediately"). Under `useSyncExternalStore` (`useSyncStatus`,
[lib/client/hooks.ts](../lib/client/hooks.ts)), calling `onStoreChange()`
synchronously *during* the subscribe phase — before `subscribe()` had
even returned — trips React's "Maximum update depth exceeded" guard. Since
`useSyncExternalStore`'s `getSnapshot()` already supplies the current
value, the fix was to make `subscribeSyncStatus` register for future
changes ONLY; found via manual browser verification (below), not by
static review.

### Undo/redo: client-owned, not server-owned

**Chosen: move undo/redo ownership to the client**, mirroring the exact
3-state (active/undone/superseded) machine
[lib/db/undo.ts](../lib/db/undo.ts) already implements server-side, but
now authoritative in [lib/client/undo.ts](../lib/client/undo.ts). The
compensating event is minted through the same `appendLocalEvent` path any
mutation uses and syncs up like any other event.

**Rejected: keep the server-side stack as the primary path.** It's a
round trip to find out what's on top of the stack, which item 4's
"working offline" requirement rules out directly — undo can't wait for a
network response, and queuing an opaque "undo intent" for later replay is
worse than useless: by the time it's finally sent, another device's sync
could have moved the target entity somewhere the queued intent no longer
makes sense for. The server-side stack isn't deleted — it's still
correct and still usable for a possible future server-driven surface —
it's simply not what the UI calls.

One real ordering bug surfaced writing the redo test
([lib/client/mutations.test.ts](../lib/client/mutations.test.ts) "every
mutation is undoable, in LIFO order"): `latestOf()` originally picked the
"most recent" entry in a given state by sorting on the row's own
autoincrement `id` (creation order). That's correct for the *first*
undo, but once more than one entry has been through an undo/redo cycle,
"created first" and "most recently touched" diverge — redoing would
restore actions in the wrong order. Fixed by adding an `updatedAt`
stamp bumped on every transition and sorting by that instead.

### Preference sync: a generic event, and subtasks as an additive field

**`PreferenceSet{key, from, to}`**, `entity_type: 'user'`, `key` a closed-
but-extensible enum (`theme_mode | theme_accent | theme_custom`) — one
new event type covers every current and future preference, rather than a
dedicated `ThemeChanged` needing a new type (and a new reducer case) for
every later preference. Merges via plain LWW-register: no add-wins/
restore-wins complexity is needed for a personal scalar setting.
`reduce()` gained a third branch (alongside tasks/lists) folding `user`
events into a flat `AppState.preferences` slice
([lib/domain/reducer.ts](../lib/domain/reducer.ts) `buildPreferences`).

**Subtasks** (`TaskCreated`/`TaskMoved` gain `parent_task_id`) are an
**additive optional field**, not a `schema_version` bump. Since Zod's
`.optional()` already makes a missing field behave exactly like an
explicit `null`, a version bump's upcast machinery would add ceremony
without adding any compatibility a plain optional field doesn't already
give for free. `parent_task_id` travels in `TaskMoved`'s existing atomic
`{list_id, position}` pair for the identical split-brain-prevention
reason `list_id` and `position` already share one write.
`REDUCER_VERSION` still bumped to 2, so no snapshot taken by an older
reducer is ever resumed from across this change.

### Theme token architecture

Two independent axes — **mode** (light/dark/system) and **accent**
(default/violet/amber/custom) — composed via `data-theme` plus eight raw
`--accent-*` CSS custom properties
([lib/theme/apply.ts](../lib/theme/apply.ts)) that `app/globals.css`
aliases per mode, rather than N hand-authored named themes. Mode
switching is pure CSS (an attribute flip); only an accent change needs
JS to run, and needs it exactly once per change, not on every mode
toggle.

**OKLCH, not HSL**, for every token and for the derivation math
([lib/theme/palette.ts](../lib/theme/palette.ts)): OKLCH's lightness
tracks *perceived* lightness across hues, so "step to L=0.55" means
roughly the same contrast regardless of hue, where HSL's lightness
famously doesn't have that property.

**Custom theme derivation auto-corrects rather than hard-rejecting.**
Given a base colour, [lib/theme/palette.ts](../lib/theme/palette.ts)
derives light+dark tokens and checks the WCAG 2.x contrast ratio (via
`culori.wcagContrast` — the literal AA formula, not the newer perceptual
APCA algorithm) on every pair the UI actually renders text or a UI
component with. A failing pair walks the *foreground's* lightness toward
the accessible extreme (never the hue) until it passes; only if no
accessible lightness exists anywhere in `[0,1]` — not observed against
any input tested, including a deliberately extreme one (pure yellow,
[lib/theme/palette.test.ts](../lib/theme/palette.test.ts)) — does it
report `ok: false` for the editor to refuse saving. The three built-in
accents are derived through the exact same pipeline as a custom one
([lib/theme/presets.ts](../lib/theme/presets.ts)), not a separate
hand-tuned hex table.

**No hard-coded hex, anywhere — one script, not two linters.**
[scripts/check-no-hex.mjs](../scripts/check-no-hex.mjs), wired into
`pnpm lint`, regex-scans `app/`, `components/`, `lib/` (excluding test
fixtures, which legitimately feed real hex strings in as *input* — a
colour picker accepts hex). Rejected: ESLint (can't lint `.css`) plus
Stylelint (would need an allowlist exception for wherever tokens are
defined) — since every token is authored in `oklch()` function notation,
one script needs zero exceptions anywhere, including the token file
itself. The two spec-mandated exceptions that must stay literal CSS
colours — the Web App Manifest's `background_color`/`theme_color` and
the `<meta name="theme-color">` viewport field — use `rgb()`, never hex,
so the rule stays absolute rather than needing a carve-out. The one place
hex is genuinely unavoidable, `<input type="color">` (a hex-only native
control), computes its value via `culori.formatHex()` at runtime instead
of a literal in source
([components/theme/theme-editor-dialog.tsx](../components/theme/theme-editor-dialog.tsx)) —
so there's still no hex string anywhere in the file's own text.

Testing this script found a real robustness bug, not just an app one:
it called `process.exit(1)` immediately after `console.error(...)`,
which is a known Node footgun — when stdout is a pipe rather than a TTY
(true for CI, and for a test harness capturing the output), the write
can still be in flight and get truncated, or the exit status reported
back to the parent process can come out wrong. Fixed to set
`process.exitCode` and let Node drain naturally before exiting.

### PWA: a hand-written service worker, not a build plugin

[public/sw.js](../public/sw.js) precaches the app shell (`/`, the
manifest, the icon, and Next's own JS/CSS bundle) with a stale-while-
revalidate strategy, and explicitly never intercepts `/api/*` — sync must
always hit the real network or fail fast, never a stale cached response
pretending to be live server state. Hand-written rather than a Workbox/
`next-pwa` dependency: the shell-caching need here is small and well-
bounded, and a few dozen explicit lines beat a build plugin whose
generated output is harder to audit for this scope.

**app/page.tsx stays a static Server Component**
([components/app-shell.tsx](../components/app-shell.tsx) makes the sign-
in/board decision client-side via `useSession()`) rather than gating on
`auth()` server-side. A Server Component that calls `auth()` per request
makes the whole route dynamic, which leaves the service worker nothing
meaningful to precache for a genuinely offline cold start — `next build`
confirms `/` renders as `○ (Static)` specifically because of this.

**Verified, not just designed: installed and confirmed working with the
network fully off.** Manual verification (with a real local Postgres,
since the app needs actual authenticated state to be interesting) found
two additional real bugs a design review couldn't have caught:

- `next dev`'s per-session, ever-changing asset query strings make
  service-worker caching fundamentally unreliable in dev mode — offline
  testing has to run against a production build (`next build && next
  start`), which is also the only way real users would ever experience
  it.
- Auth.js v5 rejects any request whose `Host` header it can't statically
  verify (`UntrustedHost`) unless `AUTH_URL` is set or `trustHost: true`
  is passed — this silently breaks sign-in on any production deployment
  reached by a host Vercel didn't auto-configure `AUTH_URL` for. Fixed by
  setting `trustHost: true` in
  [lib/auth/config.ts](../lib/auth/config.ts).

With both fixed: stopping the server entirely and reloading still renders
the full sign-in shell — dark mode and the chosen accent intact from the
FOUC-prevention cache — while `/api/*` calls correctly fail fast
(`ERR_CONNECTION_REFUSED`) rather than serving fabricated data.

### Testing: a third Vitest project for browser-shaped code; Playwright with per-spec test users

`lib/client/**` runs under a new **`client`** Vitest project
([vitest.workspace.ts](../vitest.workspace.ts)): jsdom + `fake-indexeddb`,
distinct from the pure-Node `unit` project, since Dexie genuinely needs a
browser-like environment.

**Playwright e2e needs a real, reachable Postgres** — PGlite (used by the
`integration` Vitest project) is in-process and can't be reached by a
separately-launched Next.js server process. There's no real GitHub OAuth
available in CI either, so [e2e/global-setup.ts](../e2e/global-setup.ts)
seeds database sessions directly, and
[e2e/fixtures.ts](../e2e/fixtures.ts) injects the resulting cookie into
each test's browser context instead of driving the real sign-in flow.

**Each spec file gets its own dedicated seeded user, never one shared
user** — this is deliberate, not incidental. The event log is append-only
by design, so a shared user's data from an earlier spec (or an earlier
run of the same spec) is *still there* when a later assertion queries
"the board" or "time travel to now"; two debugging sessions confirmed
this directly (a stray list from a previous run showing up in a later
run's time-travel snapshot; two different runs' identically-named
`"blocked"` tags both matching a `getByText` selector). Per-spec isolation
sidesteps the problem entirely without ever needing to delete anything —
consistent with the same append-only constraint the whole system is built
around. `workers: 1` in
[playwright.config.ts](../playwright.config.ts) runs specs fully
sequentially: they share one dev server and one Postgres instance, and
this environment's limited resources turned concurrent execution into
spurious failures unrelated to app correctness.

Coverage: a genuine `context.setOffline(true)` scenario
([e2e/offline.spec.ts](../e2e/offline.spec.ts)); two real browser
contexts (= two independent Dexie stores = two real devices) diverging
offline and reconciling
([e2e/divergence.spec.ts](../e2e/divergence.spec.ts)); a time-travel
assertion against a real past instant
([e2e/time-travel.spec.ts](../e2e/time-travel.spec.ts)); all 6 built-in
mode×accent combinations scanned with `@axe-core/playwright`'s
`color-contrast` rule
([e2e/theme-contrast.spec.ts](../e2e/theme-contrast.spec.ts)); and axe
scans with zero **critical** violations across six main views
([e2e/accessibility.spec.ts](../e2e/accessibility.spec.ts)) — critical,
not "zero violations at any severity", is the bar, since axe also flags
purely stylistic best-practice rules that don't actually block a
keyboard or screen-reader user.

### What's deferred

- **Cross-list drag-and-drop** — reordering within a list is implemented
  (`dnd-kit`, one `TaskMoved` event per drop); dragging a task onto a
  *different* list's column is not wired to the drag UI yet, though
  `moveTask` already supports it identically.
- **PWA icon** is a single SVG, not a full maskable-icon PNG set — Chrome/
  Edge/Android accept it, but a production ship would want generated PNG
  sizes for broader OS-chrome compatibility.
- **APCA-based contrast** as an upgrade path beyond WCAG 2.x AA, if a
  future WCAG 3 requirement calls for it — the prompt asks for AA
  specifically, which is the literal 2.x formula this uses.
