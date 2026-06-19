# Tasks — fix-audit-enforcement-logging

## Reproduce (test-first)
- [x] `tests/env/audit-enforcement-logging.test.mjs`: real-Postgres proof that a 402 quota denial writes
      `quota_enforcement_log` and a 403 writes `scope_enforcement_denials`, both with the correlation id;
      a 2xx writes nothing and an unattributable 403 records nothing.

## Implement (kind runtime AND shippable product as applicable)
- [x] `deploy/kind/control-plane/audit-writer.mjs`: add `recordQuotaEnforcement` (insert into
      `quota_enforcement_log`) and `recordRouteDenial` (insert a `scope_enforcement_denials` row for a
      local-handler 403, attributed to the verified tenant/actor, correlation id generated if absent).
- [x] `deploy/kind/control-plane/workspace-quota.mjs`: pass the resolved `source` + `dimensionKey` through
      `checkWorkspaceQuota` so the denial row is constraint-valid without re-resolving governance.
- [x] `deploy/kind/control-plane/b-handlers.mjs`: write `recordQuotaEnforcement` at the createWorkspace 402.
- [x] `deploy/kind/control-plane/server.mjs`: call `recordRouteDenial` at the local-handler dispatch (any 403).

## Verify
- [x] `node --test tests/env/audit-enforcement-logging.test.mjs` green (5/5).
- [x] No regression: `workspace-quota-enforcement` + `audit-write-and-scope-enforcement` blackbox suites green (10/10).
- [x] Acceptance: a 402/403 produces a correlated audit row.

## Archive
- [ ] `openspec validate fix-audit-enforcement-logging --strict`; `/opsx:archive fix-audit-enforcement-logging` after merge.
