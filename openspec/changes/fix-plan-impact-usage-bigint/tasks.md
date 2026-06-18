# Tasks — fix-plan-impact-usage-bigint

## Reproduce (test-first)
- [x] `tests/blackbox/plan-impact-usage-bigint.test.mjs` — drives `applyGovernanceSchema`; fails on old code where the columns are INTEGER.

## Implement (kind runtime AND shippable product as applicable)
- [x] `services/provisioning-orchestrator/src/migrations/100-plan-change-impact-history.sql`: `observed_usage`, `previous_effective_value`, `new_effective_value` → BIGINT; idempotent guarded `ALTER ... TYPE BIGINT` upgrades existing tables (migration re-runs each boot).

## Verify
- [x] `node --test tests/blackbox/plan-impact-usage-bigint.test.mjs` green; governance-schema-bootstrap unaffected.
- [x] Acceptance: plan assign with multi-GB usage → 2xx; impact row persisted; entitlements reflect the plan (no INTEGER-overflow 500).

## Archive
- [ ] `openspec validate fix-plan-impact-usage-bigint --strict`; `/opsx:archive fix-plan-impact-usage-bigint` after merge.
