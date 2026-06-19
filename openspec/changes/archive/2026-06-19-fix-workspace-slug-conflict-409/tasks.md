# Tasks — fix-workspace-slug-conflict-409

## Reproduce (test-first)
- [x] Added a failing black-box test (`tests/blackbox/workspace-slug-conflict-409.test.mjs`,
  bbx-wsslug-01..02) that drives `createWorkspace` directly:
  - `bbx-wsslug-01`: simulate a unique-violation from `store.insertWorkspace` (stub throws with
    `e.code === '23505'`) → assert response is `409 WORKSPACE_SLUG_CONFLICT` and the body does NOT
    contain the string `23505`;
  - `bbx-wsslug-02`: happy path with a novel slug → assert `201` (no regression).

## Implement
- [x] `deploy/kind/control-plane/b-handlers.mjs::createWorkspace`: wrapped `store.insertWorkspace`
  in try/catch; `e.code === '23505'` → `409 WORKSPACE_SLUG_CONFLICT`; all other errors re-thrown.
- [x] `deploy/kind/control-plane/server.mjs` (central error handler): on a 5xx response, replace
  any backend-specific code (raw SQLSTATE, etc.) with `CONTROL_PLANE_ERROR` (defense-in-depth;
  prevents internals disclosure on any future unhandled path).

## Verify
- [x] New black-box tests pass (2/2: bbx-wsslug-01, bbx-wsslug-02); `bash tests/blackbox/run.sh`
  green (997/997 pass); no regression in workspace-quota-enforcement or workspace-db-provisioning
  tests.
- [x] Body of the 409 contains `WORKSPACE_SLUG_CONFLICT` and no `23505` string.
- [ ] Acceptance (real-stack): send two concurrent `POST /v1/tenants/{id}/workspaces` with the same
  slug on the kind cluster; verify exactly one `201` and one `409 WORKSPACE_SLUG_CONFLICT`, no
  `500`, and no `23505` in any response body.

## Archive
- [ ] `openspec validate fix-workspace-slug-conflict-409 --strict`; archive after merge.
