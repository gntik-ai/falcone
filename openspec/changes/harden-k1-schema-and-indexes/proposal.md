## Why

The workspace-docs persistence schema sets `search_path` as a session
side effect, lacks a CHECK on content length, has no covering index for
the `ORDER BY` in `listNotes`, and has no FK or PK protection on
multi-tenant ownership columns. From
`openspec/audit/cap-k1-workspace-docs-service.md`:

- **B18** (`migrations/087-workspace-doc-notes.sql:1`) — `SET search_path
  TO workspace_docs_service` is a session-scoped state change inherited
  by subsequent migrations; per-statement schema-qualification is safer.
- **B21** (`migrations:14-16`, `note-repository.mjs:44-54`) — the
  existing partial index on `(tenant_id, workspace_id) WHERE deleted_at
  IS NULL` does not cover the `ORDER BY created_at ASC` in `listNotes`;
  large workspaces pay an in-memory sort.
- **G19** (`G-DB.1`) — `setSearchPath` session-state side effect
  (same as B18, raised).
- **G20** (`G-DB.2`) — no DB-level CHECK on `LENGTH(content) <= max`;
  enforcement is entirely at the action layer.
- **G21** (`G-DB.3`) — no FK on `workspace_id` / `tenant_id`. Although
  they are TEXT (no obvious target table from this migration alone),
  the columns can be declared with a NOT NULL + indexed CHECK as a
  partial guard.
- **G22** (`G-DB.4`) — `workspace_doc_access_log` lacks an index
  matching the access-log dedup PK ordering for daily-rollup queries.

## What Changes

- Add a new migration `088-workspace-doc-notes-hardening.sql` that:
  removes the session-scoped `SET search_path` from the migration
  template, adds `CHECK (char_length(content) <= 4096)` on
  `workspace_doc_notes.content` (matching the default cap), creates
  a compound partial index on `(tenant_id, workspace_id, created_at)
  WHERE deleted_at IS NULL` covering the `listNotes` ORDER BY, and
  adds a rolling index on `workspace_doc_access_log(access_date)` for
  ops queries.
- Adjust the migration runner template / lint check to forbid bare
  `SET search_path` outside transactional blocks; require
  schema-qualified DDL.

## Capabilities

### Modified Capabilities

- `workspace-management`: requirements on persistence-layer enforcement
  of content length, index coverage of `listNotes`, and absence of
  session-scoped migration side effects.

## Impact

- **Affected code**: `services/workspace-docs-service/migrations/`
  (new file), `services/workspace-docs-service/src/note-repository.mjs`
  (no logic change; the new index just becomes effective).
- **Migration required**: yes — additive forward-only;
  `088-workspace-doc-notes-hardening.sql`.
- **Breaking changes**: existing notes longer than 4096 chars
  (impossible at the action layer today, but possible if any direct DB
  writes occurred) will fail the CHECK on `ALTER TABLE`. The migration
  must `VALIDATE CONSTRAINT` separately if such rows exist.
- **Cross-cutting**: query plans for `listNotes` improve on workspaces
  with thousands of notes.
