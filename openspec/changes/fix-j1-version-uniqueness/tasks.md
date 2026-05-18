## 1. Failing tests

- [ ] 1.1 [test] Add a case to
      `services/openapi-sdk-service/tests/integration/spec-version-repo.test.mjs`
      that performs three successive `insertNewSpec` calls in distinct
      transactions and asserts the third call succeeds and
      `getSpecHistory(pool, workspaceId, 5)` returns three rows, proving
      B1 at `migrations/088-workspace-openapi-versions.sql:11`.
- [ ] 1.2 [test] Add a case that attempts to manually INSERT two rows with
      `is_current = TRUE` for the same workspace and asserts the second
      fails with a unique-index violation.

## 2. Implementation

- [ ] 2.1 [migration] Create
      `services/openapi-sdk-service/migrations/089-workspace-openapi-versions-history.sql`
      that runs `ALTER TABLE workspace_openapi_versions DROP CONSTRAINT
      workspace_openapi_versions_workspace_id_is_current_key`.
- [ ] 2.2 [migration] In the same migration, add
      `CREATE UNIQUE INDEX workspace_openapi_versions_current_uq ON
      workspace_openapi_versions (workspace_id) WHERE is_current = TRUE`.
- [ ] 2.3 [migration] Pre-flight with `SELECT workspace_id FROM
      workspace_openapi_versions WHERE is_current = TRUE GROUP BY
      workspace_id HAVING count(*) > 1`; abort if any row returned.
- [ ] 2.4 [fix] Verify `spec-version-repo.mjs:27-47` `insertNewSpec`
      transaction continues to function with the partial-index semantics;
      add a comment explaining the dependency on the new index.

## 3. Validation

- [ ] 3.1 [docs] Document the partial-index semantics in
      `services/openapi-sdk-service/README.md` and note the migration order
      requirement (089 must follow 088).
- [ ] 3.2 [test] Re-run
      `corepack pnpm --filter openapi-sdk-service test`; green before merge.
