# Tasks — fix-governance-schema-bootstrap

## Reproduce (test-first)
- [x] Failing black-box test: `tests/blackbox/governance-schema-bootstrap.test.mjs` (bbx-555-01..04). RED before (the `governance-schema.mjs` module did not exist → import error), GREEN after. Drives `applyGovernanceSchema` over the REAL migration .sql files and asserts the three missing tables + the quota dimension catalog are created/seeded in dependency-safe order. (Live equivalent: capability-catalog / plan-assign / scope-enforcement audit 500 with PostgreSQL 42P01; dimension catalog 0 rows.)

## Implement (kind runtime AND shippable product)
- [x] New `deploy/kind/control-plane/governance-schema.mjs` — `applyGovernanceSchema(pool)` applies the governance migration set (093 scope-enforcement, 097 plans+`set_updated_at_timestamp()`, 098 quota_dimension_catalog+seed, 100 tenant_plan_change_history, 103 quota_overrides, 104 boolean_capability_catalog+seed, 105 workspace_sub_quotas, 121 flow-dimension seed) in dependency-safe numeric order. Idempotent (every file is `CREATE TABLE IF NOT EXISTS` + `INSERT … ON CONFLICT DO NOTHING`).
- [x] Wired into the boot in `deploy/kind/control-plane/server.mjs` inside the existing `runWithRetry` (cold-start safe), right after `ensureSchema`/`ensureSagaSchema`.
- [x] ROOT CAUSE / proposal correction: `required-migrations.txt` listed these as "already applied" but **nothing consumed it** — the kind boot only ran `ensureSchema` (domain-B tables), so the governance tables never existed in `in_falcone` while `b-handlers.mjs` dynamically imports the REAL product actions that query them. The product migrations themselves are unchanged (correct as-is); the gap was purely that the kind runtime never applied them. The whole `services/provisioning-orchestrator` tree (incl. these .sql) is already COPYed to `/repo` by the control-plane Dockerfile, so no image change is needed.

## Verify
- [x] `node --test tests/blackbox/governance-schema-bootstrap.test.mjs` → 4/4 green; `node --check` on the new module + server.mjs OK. (Full suite + CI quality subset in the batch barrier.)
- [ ] Acceptance (live): capability-catalog / plan-assign / scope-enforcement audit → 200; a limit can be defined against a seeded dimension — folded into the consolidated live RED→GREEN verification on kind.

## Archive
- [ ] `openspec validate fix-governance-schema-bootstrap --strict`; archive in the batch (after the combined commit closing the issue).
