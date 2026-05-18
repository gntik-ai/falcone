## 1. Failing tests

- [ ] 1.1 [test] Add tests under `services/provisioning-orchestrator/src/tests/actions/secret-audit-harden.test.mjs` proving (a) two concurrent `privilege-domain-assign` revokes against the same last structural_admin do not both succeed (B5.6), (b) `credential-rotation-repo.expirySweep` invoked twice over the same row revokes exactly once and emits exactly one event (B5.7), (c) `function-privilege-denial-recorder.validate` rejects a workspace-scoped denial whose `workspaceId` is null (B5.8), (d) `scope-enforcement-repo.list` does not skip rows whose `(denied_at, id)` collides at page boundary (B5.9), and (e) a consumer-reported apply failure transitions `secret_propagation_events.state` to `failed` (G30).

## 2. Implementation

- [ ] 2.1 [fix] Replace the count-then-upsert pair in `services/provisioning-orchestrator/src/actions/privilege-domain-assign.mjs:43-50` with a single CTE that performs the last-admin guard and the upsert under one `FOR UPDATE` scope.
- [ ] 2.2 [fix] Rewrite `services/provisioning-orchestrator/src/repositories/credential-rotation-repo.mjs:22-23` to a single `UPDATE … RETURNING` that revokes only currently-deprecated rows; emit events for the returned set.
- [ ] 2.3 [fix] In `services/provisioning-orchestrator/src/actions/function-privilege-denial-recorder.mjs:25`, reject records where `requiredSubdomain` is workspace-scoped but `workspaceId` is null.
- [ ] 2.4 [fix] In `services/provisioning-orchestrator/src/repositories/scope-enforcement-repo.mjs:10,56`, switch cursor compare to `(denied_at, id) > ($1, $2)` and reject decoded cursors with null fields.
- [ ] 2.5 [fix] Wire an apply-failure path that transitions `secret_propagation_events.state` to `failed` (consumer-ack path or a dedicated `secret-consumer-fail` action), removing the dead enum value (G30).

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @falcone/provisioning-orchestrator test src/tests/actions/secret-audit-harden.test.mjs` and `openspec validate harden-c1-secret-rotation-audit --strict`; both green before merge.
