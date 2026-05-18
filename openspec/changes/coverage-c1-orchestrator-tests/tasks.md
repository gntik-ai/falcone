## 1. Failing tests

- [ ] 1.1 [test] Add `services/provisioning-orchestrator/src/tests/__meta/suite-runs.test.mjs` that asserts `vitest` discovers all 62 existing `*.test.mjs` files and reports zero "skipped" or "no-tests-found" outcomes. This proves the suite is wired (it should fail today because the suite is not wired).

## 2. Triage and repair

- [ ] 2.1 [test] Catalogue all 62 `*.test.mjs` files into a `services/provisioning-orchestrator/src/tests/__meta/triage.md` table with `{path, status: passing|drift|env|unsalvageable, note}` rows after running `pnpm --filter @falcone/provisioning-orchestrator test` once.
- [ ] 2.2 [fix] Repair every `drift`-bucket test so its assertions match current handler behaviour; preserve the original intent (do not weaken assertions to silence failures).
- [ ] 2.3 [test] Add `services/provisioning-orchestrator/src/tests/__helpers/` containing `pg-mem` and `kafkajs` in-memory doubles (port from `apps/control-plane/src/tests/__helpers/` where present); migrate every `env`-bucket test to consume the helpers.
- [ ] 2.4 [fix] Delete unsalvageable tests; record the deletion rationale per file in the PR description.

## 3. Validation

- [ ] 3.1 [test] Run `pnpm --filter @falcone/provisioning-orchestrator test`, measure baseline coverage, set the CI coverage threshold to the measured floor minus 2% as a safety margin, and `openspec validate coverage-c1-orchestrator-tests --strict`; all green before merge.
