# CLAUDE.md — Rewind

## What we are building

Rewind: an offline-first, event-sourced task platform. Every mutation is an
immutable event; current state is a projection. This buys us time-travel
history, true undo/redo, and conflict-free multi-device sync. It is not a
CRUD to-do app — if a feature can only be built by mutating rows in place,
stop and flag it.

## Non-negotiable principles

1. The event log is append-only. No UPDATE, no DELETE on events, ever.
   Corrections are new events.
2. Every event carries: id (UUIDv7), actor_id, entity_id, type, payload,
   client_timestamp, server_timestamp, and a vector clock for causality.
3. The app is fully usable offline. Every mutation writes locally first,
   optimistically updates the UI, and queues for sync. Network is an
   enhancement, never a requirement.
4. Sync is idempotent. Replaying the same event twice must be a no-op.
   Every event id is deduped server-side.
5. Conflicts merge, they do not overwrite. Two devices editing the same task
   offline must both survive with a documented, tested merge rule.
6. Theming is a token system, not a class toggle. All colour, spacing, and
   typography come from CSS custom properties; no hard-coded hex anywhere.

## Tech stack (do not substitute without asking)

- Next.js 15 (App Router) + TypeScript strict mode
- PostgreSQL + Drizzle ORM (migrations checked into the repo)
- Auth.js v5 with GitHub OAuth
- Local store: IndexedDB via Dexie
- Real-time: Server-Sent Events for live multi-device updates
- UI: Tailwind + shadcn/ui + Framer Motion
- State: Zustand for client state, TanStack Query for server state
- Testing: Vitest (unit), Playwright (E2E including offline scenarios)
- Deploy: Vercel + Neon/Render Postgres

## Code standards

- TypeScript strict. No `any`. Zod schemas for every API boundary and every
  event payload, shared between client and server.
- Server Components by default; Client Components only where interactivity
  demands it.
- Every API route validates input with Zod and returns typed errors.
- Events are defined once in a shared schema module and imported by both
  the reducer and the API.
- No business logic in components. Domain logic lives in lib/domain.

## End-of-prompt workflow (ALWAYS, unless told otherwise)

1. Run the full test suite and typecheck; confirm green
2. Update docs/DECISIONS.md with this prompt's decisions and what was
   rejected
3. Update the relevant README section
4. Commit (Conventional Commits, multiple commits if logically separate)
   and push to origin
5. Print a one-paragraph summary of what shipped and what is still open

## How to work with me

- Propose the design in 5-10 bullets before writing a new subsystem, and
  WAIT for approval.
- On any real trade-off (merge strategy, sync protocol, projection
  rebuild), give two options with pros and cons plus your recommendation.
  Do not silently pick one.
