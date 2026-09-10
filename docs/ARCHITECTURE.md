# Architecture

Three sequence diagrams covering the three moments that make this app
what it is: a mutation while offline, the sync round trip that reconciles
it, and a genuine conflict merge. See [README.md](../README.md) for the
component-level architecture diagram and [DECISIONS.md](DECISIONS.md) for
why each piece is built the way it is.

## 1. A mutation while offline

Every mutation writes to Dexie first and returns before any network call
exists — this diagram has no server or network participant at all,
because none is involved.

```mermaid
sequenceDiagram
    actor User
    participant UI as React UI
    participant Mut as lib/client/mutations.ts
    participant Factory as lib/events/factory.ts
    participant Dexie as Dexie (IndexedDB)
    participant Proj as lib/client/projection.ts

    User->>UI: renames a task
    UI->>Mut: renameTask(taskId, "New title")
    Mut->>Dexie: read current task (for the "from" value)
    Mut->>Factory: createEvent(TaskRenamed, {from, to}, vector_clock)
    Factory-->>Mut: event (UUIDv7 id, client_timestamp, server_timestamp: null)
    Mut->>Dexie: one transaction: insert into events + outbox
    Mut->>Proj: rebuildLocalProjection(taskId)
    Proj->>Dexie: replay this entity's event slice through reduce()
    Proj->>Dexie: upsert the resolved task into `tasks`
    Dexie-->>UI: live query fires (dexie-react-hooks)
    UI-->>User: title updates immediately

    Note over Mut,Dexie: No network call anywhere above.<br/>The event now sits in `outbox`<br/>until lib/client/sync-engine.ts sends it.
```

## 2. A sync round trip

One request does both push and pull, in one server-side transaction —
this is what makes replaying the same batch after a dropped connection
safe (`accepted` and `duplicates` are both treated as "confirmed,
drop from outbox").

```mermaid
sequenceDiagram
    participant Engine as lib/client/sync-engine.ts
    participant Outbox as Dexie outbox
    participant API as POST /api/sync
    participant Val as Zod validation
    participant Seq as event_sequences (row lock)
    participant DB as events (Postgres)
    participant ProjDB as projections (Postgres)

    Engine->>Outbox: getPending() + current cursor/clock
    Engine->>API: {device_id, since_seq, client_clock, events[]}
    API->>Val: validate + upcast the WHOLE batch

    alt any event invalid
        Val-->>API: reject
        API-->>Engine: 422 {rejected: [...]}, nothing written
        Note over Engine,API: Atomic: a partial accept could leave<br/>a causal hole. Engine quarantines the<br/>named ids and retries without them.
    else batch is valid
        API->>DB: SELECT id WHERE id IN (...) — dedupe check
        API->>Seq: allocate user_seq for genuinely-new events<br/>(per-user row lock — serialises appends)
        API->>DB: INSERT ... ON CONFLICT (id) DO NOTHING
        API->>ProjDB: rebuild projection for each touched entity<br/>(replay that entity's full event slice)
        API->>DB: SELECT events WHERE user_seq > since_seq<br/>AND device_id <> caller's device
        API-->>Engine: {accepted, duplicates, events: [...], next_seq, server_clock}
        Engine->>Outbox: clear ids in accepted AND duplicates
        Engine->>Outbox: applyRemote(pulled events)
        Engine->>Outbox: advance cursor to next_seq
    end
```

## 3. A conflict merge

Two devices — really, two browser contexts, each with their own Dexie
store — edit the *same* task while both are offline, then both
reconnect. Which one syncs first doesn't matter: the merge rule is a
pure function of the two writes, not of arrival order.

```mermaid
sequenceDiagram
    participant A as Device A (offline)
    participant B as Device B (offline)
    participant API as POST /api/sync
    participant DB as events (Postgres)
    participant Merge as lib/domain/merge.ts

    Note over A,B: Both start from the same synced task (no tags yet).
    A->>A: TagAdded("urgent") — local only
    B->>B: TagAdded("blocked") — local only, unaware of A's edit

    A->>API: push [TagAdded("urgent")]
    API->>DB: insert, assign user_seq
    API-->>A: accepted

    B->>API: push [TagAdded("blocked")], pull since B's cursor
    API->>DB: insert B's event, assign user_seq
    API->>DB: SELECT events since B's cursor → includes A's TagAdded("urgent")
    API-->>B: accepted: [blocked], events: [TagAdded("urgent")]

    Note over API,Merge: On the server, rebuilding the task's projection<br/>calls reduce() over BOTH tag-add events.
    API->>Merge: resolveBiasedBoolean([urgent: true, blocked: true], bias=true)
    Merge-->>API: both keys are independent — both resolve true
    Note over API: tags = ["blocked", "urgent"]

    B->>B: applyRemote(TagAdded("urgent")) → reduce() locally → tags = [blocked, urgent]
    A->>API: next sync cycle pulls TagAdded("blocked")
    A->>A: reduce() locally → tags = [blocked, urgent]

    Note over A,B: Both devices converge on the identical<br/>canonical state — neither tag was lost,<br/>and it didn't matter which device synced first.
```

For a merge where the two writes touch the *same* field (e.g. two
concurrent renames), `merge.ts` doesn't have real intent to reconcile —
it falls back to a deterministic tiebreak on
`(client_timestamp, device_id, event_id)`, which is a total order over
any two events, so every device computes the identical winner regardless
of which one it heard about first. See
[DECISIONS.md](DECISIONS.md#conflict-resolution-operation-based-merge-lww-register-default)
for the full merge table.
