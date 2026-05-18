## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/workspace-docs-service/src/note-repository.test.mjs` that
      issues `EXPLAIN (FORMAT JSON) SELECT … ORDER BY created_at` and
      asserts the plan uses the new compound index (no `Sort` node).
- [ ] 1.2 [test] Add a case that attempts a direct DB INSERT into
      `workspace_doc_notes` with a 4097-char content and asserts the
      CHECK constraint rejects it.
- [ ] 1.3 [test] Add a case linting `migrations/*.sql` to assert no
      file begins with `SET search_path` outside an explicit `BEGIN /
      COMMIT` block.

## 2. Implementation

- [ ] 2.1 [migration] Create
      `services/workspace-docs-service/migrations/088-workspace-doc-notes-hardening.sql`
      adding `CHECK (char_length(content) <= 4096)` on
      `workspace_docs_service.workspace_doc_notes(content)`.
- [ ] 2.2 [migration] In the same file, create
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS
      workspace_doc_notes_list_idx ON
      workspace_docs_service.workspace_doc_notes (tenant_id,
      workspace_id, created_at) WHERE deleted_at IS NULL`.
- [ ] 2.3 [migration] In the same file, add
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS
      workspace_doc_access_log_date_idx ON
      workspace_docs_service.workspace_doc_access_log (access_date)`.
- [ ] 2.4 [fix] Remove the bare `SET search_path` from
      `migrations/087-workspace-doc-notes.sql:1`; rewrite remaining
      DDL with schema-qualified names.
- [ ] 2.5 [impl] Add a CI-time lint rule
      (`scripts/lint-migrations.mjs` or analogous) that fails the build
      when any migration begins with bare `SET search_path`.

## 3. Validation

- [ ] 3.1 [test] Re-run K1 repository tests, migration tests, and
      `openspec validate harden-k1-schema-and-indexes --strict`; all green.
- [ ] 3.2 [docs] Document the new CHECK and index in
      `services/workspace-docs-service/README.md` (schema section).
