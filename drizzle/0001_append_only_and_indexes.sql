-- Hand-written migration: not produced by `drizzle-kit generate`, because
-- Drizzle's schema DSL (lib/db/schema.ts) has no way to express triggers,
-- and additional non-unique composite indexes needed here don't round-trip
-- cleanly through the ORM's index builder used elsewhere. Checked in
-- alongside the generated migrations so `drizzle-kit migrate` applies it
-- in order, and so the append-only guarantee ships with the schema
-- instead of depending on someone remembering a manual `psql` step.

-- ---------------------------------------------------------------------------
-- CLAUDE.md principle 1: "The event log is append-only. No UPDATE, no
-- DELETE on events, ever." Enforced in the database, not just in
-- application code, so a bug (or a future maintainer with a REPL) can't
-- silently violate it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reject_events_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events is append-only: % is not permitted (CLAUDE.md principle 1)', TG_OP;
END;
$$ LANGUAGE plpgsql;

-- Row-level trigger covers UPDATE and DELETE.
CREATE TRIGGER events_no_update_delete
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION reject_events_mutation();

-- Row-level triggers never fire for TRUNCATE — it needs its own
-- statement-level trigger.
CREATE TRIGGER events_no_truncate
  BEFORE TRUNCATE ON events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_events_mutation();

-- Defence in depth: even if the triggers were somehow dropped, the
-- application's own DB role cannot UPDATE/DELETE/TRUNCATE this table.
-- (No-op under a superuser role such as PGlite's test user, which is
-- exactly why the trigger — not just this REVOKE — is the real
-- enforcement mechanism the append-only test asserts against.)
REVOKE UPDATE, DELETE, TRUNCATE ON events FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Indexes, each justified (see lib/db/schema.ts for the PK and the
-- events_user_seq_unique constraint, which cover the other two indexes
-- named in the design doc).
-- ---------------------------------------------------------------------------

-- Time travel (GET /snapshot?at=<timestamp>) and the default history
-- timeline ordering both scan "this user's events up to some instant in
-- server-settled order".
CREATE INDEX events_user_id_server_timestamp_idx ON events (user_id, server_timestamp);

-- Per-entity history and entity-scoped projection rebuilds
-- (lib/db/projections.ts) — both need "every event for one task/list, in
-- settled order" without scanning the whole user's log.
CREATE INDEX events_entity_id_user_seq_idx ON events (entity_id, user_seq);

-- GET /history's type filter.
CREATE INDEX events_user_id_type_server_timestamp_idx ON events (user_id, type, server_timestamp);

-- Undo/redo stack scans: "latest entry for this device" (lib/db/undo.ts).
CREATE INDEX undo_entries_user_device_idx ON undo_entries (user_id, device_id, id DESC);
