## 1. Reproduce / encode the issue

- [x] 1.1 Parse issue #786 acceptance criteria:
  - Requirement: Function rollback works and UI is consistent.
  - Scenario 1: when a function has at least two versions and a tenant owner rolls back, the active
    version changes to the selected prior version and retained history remains visible.
  - Scenario 2: when detail says rollback is available, the Versions tab lists prior versions and
    the Rollback button is enabled.
- [x] 1.2 Confirm root cause from the verifier evidence: no retained history table, `upsertFnAction`
  overwrites source while incrementing `fn_actions.version`, `fnVersions` returns only active `vN`,
  `fnRollback` is a no-op, and the console sees inconsistent rollback availability.
- [x] 1.3 Add regression coverage for retained history, rollback state mutation, legacy no-history
  handling, and console Versions-tab consistency.

## 2. Implement the minimal backend fix

- [x] 2.1 Add `fn_action_versions` in `ensureSchema` without changing existing `fn_actions` columns.
- [x] 2.2 Populate `fn_action_versions` from `upsertFnAction` on creates and updates.
- [x] 2.3 Backfill the current active `fn_actions` row before the first post-upgrade update of a
  legacy no-history function action overwrites it.
- [x] 2.4 Add store helpers to list retained versions, summarize active/eligible state, and activate
  a selected retained snapshot.
- [x] 2.5 Make detail/list responses use retained history for `activeVersionId`, `versionCount`, and
  `rollbackAvailable`.
- [x] 2.6 Make `fnVersions` return contract-shaped `fnv_...` version IDs with active/historical
  statuses and `rollbackEligible` only for retained prior versions.
- [x] 2.7 Make `fnRollback` validate same-function same-scope targets, reject missing/current/
  ineligible targets, redeploy the selected snapshot when a Knative service exists, and update the
  active `fn_actions` row to the selected source snapshot.
- [x] 2.8 Gate rollback as a function write after scoped action lookup so foreign tenants still get
  404, while same-tenant non-admin callers get 403 before deploy or database activation side effects.

## 3. Frontend, docs, and OpenSpec

- [x] 3.1 Keep the console behavior tight: no visible UI change is required because it already lazy
  loads versions, selects the first eligible version, disables rollback when no eligible target
  exists, and reloads detail/versions after rollback.
- [x] 3.2 Add focused Vitest coverage proving detail rollback availability and Versions-tab eligible
  history stay consistent.
- [x] 3.3 Add this OpenSpec change under `openspec/changes/fix-786-function-rollback-history/`.
- [x] 3.4 Add architecture documentation for function rollback history.

## 4. Verify

- [x] 4.1 Run the new backend black-box test.
- [x] 4.2 Run focused web-console Vitest for `ConsoleFunctionsPage`.
- [x] 4.3 Run `openspec validate fix-786-function-rollback-history --strict`.
- [x] 4.4 Run `npm run generate:public-api` and confirm no generated drift.
- [x] 4.5 Run `git diff --check`.
