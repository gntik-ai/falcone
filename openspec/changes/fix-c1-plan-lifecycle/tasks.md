## 1. Failing tests

- [ ] 1.1 [test] Add tests under `services/provisioning-orchestrator/src/tests/actions/plan-lifecycle.test.mjs` that prove (a) `plan-assign` against a missing `tenants` table returns an error rather than `true` (B1.1), (b) re-invoking `plan-change-history-repository.insert` on the same `plan_assignment_id` rejects with conflict rather than overwriting (B1.2), and (c) `plan-capability-audit-query` returns a non-null `plan_slug` matching the joined plan row (B1.3).

## 2. Implementation

- [ ] 2.1 [fix] In `services/provisioning-orchestrator/src/actions/plan-assign.mjs:24-27`, remove the `42P01` catch in `ensureTenantExists`; propagate the error so the caller observes the missing table.
- [ ] 2.2 [fix] In `services/provisioning-orchestrator/src/repositories/plan-change-history-repository.mjs:59`, replace `ON CONFLICT (plan_assignment_id) DO UPDATE` with a strict `INSERT` and update the assignment-supersede flow to write a fresh `plan_assignment_id` per change.
- [ ] 2.3 [fix] In `services/provisioning-orchestrator/src/actions/plan-capability-audit-query.mjs:17-18,46-47`, extend the SELECT to join `plans` and project `plan_slug`; remove the field from the response shape if the join cannot be added.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @falcone/provisioning-orchestrator test src/tests/actions/plan-lifecycle.test.mjs` and `openspec validate fix-c1-plan-lifecycle --strict`; both green before merge.
