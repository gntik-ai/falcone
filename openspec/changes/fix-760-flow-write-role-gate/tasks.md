## 1. Reproduce / encode the contract

- [x] 1.1 Confirm root cause on `main` (HEAD `249f7bf7`): `flow-executor.mjs::executeFlows` calls only
  `requireIdentity(identity)` (tenant/workspace presence) then dispatches `create_definition` /
  `update_definition` / `delete_definition` / `publish_version` straight to the store with NO role
  check; the only `403` in the file is `CROSS_TENANT_FORBIDDEN` (unrelated to write-role). The
  gateway strips `x-actor-roles` on the `2017-flows` route and the executor verifies the JWT itself,
  so a read-only `tenant_viewer` arrives as `roles:['tenant_viewer']`.
- [x] 1.2 Add `tests/unit/flow-write-role-gate.test.mjs` driving `createFlowExecutor({ store, … })`
  with a recording fake store (mutating methods push to `calls`; `getDefinition` returns a fixture so
  update/delete/publish pass `getDefinitionOr404` for authorized roles) + a fake Temporal client
  whose `workflow.list` yields nothing (so `delete_definition`'s `hasActiveExecutions` is `false`).
  Encodes the acceptance criteria:
  - `viewer` (`roles:['tenant_viewer']`) & `developer` (`roles:['tenant_developer']`) →
    `create_definition` / `update_definition` / `delete_definition` / `publish_version` each
    `assert.rejects` with `statusCode === 403` && `code === 'FORBIDDEN'` AND the fake store mutating
    method was NEVER called (`calls` empty).
  - `owner` / `wsadmin` (`workspace_admin`) / `superadmin` → the same four ops are authorized
    (resolve, the matching store mutating method is called) with the call carrying the caller's
    `tenantId` / `workspaceId` (no-weakening guard).
  - RED on `main` (no gate → a viewer write reaches the store), GREEN on the branch.

## 2. Fix (minimal, consistent with the executor's existing role gate)

- [x] 2.1 NEW `apps/control-plane/src/runtime/auth-roles.mjs` exporting `WRITE_CAPABLE_ADMIN_ROLES`
  (`{tenant_owner, tenant_admin, workspace_owner, workspace_admin, platform_admin, superadmin}`) plus
  `hasWriteCapableRole` / `isKnownNonWriteRole`. Imports nothing from the runtime → no cycle.
- [x] 2.2 `server.mjs`: import `WRITE_CAPABLE_ADMIN_ROLES`; make `KEY_MGMT_ADMIN_ROLES` an alias of it
  (the API-key management gate is byte-identical — same set, same predicate).
- [x] 2.3 `flow-executor.mjs`: import `isKnownNonWriteRole`; add module-level
  `DEFINITION_WRITE_OPERATIONS = {create_definition, update_definition, delete_definition,
  publish_version}` and `requireDefinitionWriteRole(identity)` (throws `clientError(…, 403,
  'FORBIDDEN')` when `isKnownNonWriteRole(identity.roles)`); call it in `executeFlows` after
  `requireIdentity` and before the dispatch when the operation is in `DEFINITION_WRITE_OPERATIONS`.
- [x] 2.4 Do NOT gate execution/read ops (start/cancel/retry/signal, list/get executions, list/get
  definitions/versions, task-type catalog, `validate`). Use defer-on-unknown semantics (undefined /
  empty roles defer) so no-claims admin tokens, the trusted-gateway path, and the no-DB black-box
  mode are not regressed.

## 3. Wire / frontend / docs

- [x] 3.1 No OpenAPI/contract/SDK change (`403` is a standard authz outcome; flow writes are executor
  routes, not in the public OpenAPI idempotency-gated set) and no `public-route-catalog.json` change
  (the writes are already tagged `structural_admin`) — confirm no `*.openapi.json` / generated file /
  catalog is edited; `generate:public-api` produces no diff.
- [x] 3.2 Frontend assessment: the console surfaces a rejected write as an error banner
  (`ConsoleFlowsPage` `createError`; `ConsoleFlowDesignerPage` `applyServerRejection` → `loadError`)
  with no crash / unhandled rejection, so the new `403` degrades gracefully — NO frontend change.
  Proactive role-aware UI (hide/disable "New flow") is the separate enhancement #761, out of scope.
- [x] 3.3 `docs/reference/architecture/flow-schedule-management.md` — add "Role authorization on
  flow-definition writes" documenting the gate, production parity, that `tenant_viewer` / non-write
  roles get `403`, and that execution/read ops and `validate` are not write-gated.
- [x] 3.4 Spec delta: `openspec/changes/fix-760-flow-write-role-gate/specs/workflows/spec.md` —
  `## ADDED Requirements` (NOT MODIFIED; the `workflows` spec has no existing flow-write-authorization
  requirement) under the real `workflows` capability, one new requirement ("Flow-definition writes
  require a write-capable tenant/workspace role") with WHEN/THEN scenarios matching the acceptance
  criteria.

## 4. Design decisions recorded

- [x] 4.1 Record in `proposal.md`: the route-catalog `structural_admin` domain is declarative
  (`scope-enforcement.lua` is a `nil` stub); we deliberately reuse the executor's existing
  write-capable admin role set (`KEY_MGMT_ADMIN_ROLES`, #624) for consistency/minimal regression.
  Finer per-workspace-role audiences are a pre-existing broader gap (#761/#773), out of scope; gating
  non-write roles here also closes the flows slice of #773.
- [x] 4.2 Record the cross-tenant ordering note: cross-tenant is denied at the `server.mjs` dispatch
  (`CROSS_TENANT_VIOLATION`) before `executeFlows`, and store calls stay scoped by the verified
  `identity.tenantId`/`workspaceId`, so the gate neither weakens nor reorders the cross-tenant path.

## 5. Verify

- [ ] 5.1 CI runs `pnpm test:unit` (`node --test tests/unit/*.test.mjs`, `ci.yml`) — the new test is
  the executed regression slice. (Local Node exec is permission-gated in this environment; CI is the
  regression gate.)
- [ ] 5.2 Confirm the existing flows suites still pass: `tests/blackbox/flows-api.test.mjs` and
  `tests/unit/flow-executor-workflow-id.test.mjs` use identities WITHOUT a `roles` field (undefined),
  which DEFERS, so create/update/delete/publish and the execution-ownership tests remain green.
- [ ] 5.3 `openspec validate fix-760-flow-write-role-gate --strict` (if the CLI is available).
