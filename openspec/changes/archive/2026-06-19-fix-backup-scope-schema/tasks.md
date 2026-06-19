# Tasks — fix-backup-scope-schema

## Reproduce (test-first)
- [x] Add a failing black-box probe reproducing the missing schema: `tests/blackbox/governance-schema-bootstrap.test.mjs` (bbx-595-01) asserts the bootstrap creates `deployment_profile_registry` + `backup_scope_entries` — failing while migration 114 was absent from `GOVERNANCE_MIGRATIONS`. (Live: superadmin `GET /v1/admin/backup/scope` -> 500 `{code:42P01}`; acme-ops `GET /v1/tenants/{globex}/backup/scope` -> 403 (isolation holds).)

## Implement (kind runtime AND shippable product as applicable)
- [x] Add migration 114 (`114-backup-scope-deployment-profiles.sql`) to the kind control-plane governance bootstrap (`deploy/kind/control-plane/governance-schema.mjs::GOVERNANCE_MIGRATIONS`), ordered after 104/097 (its prerequisites). The product already ships the migration under `services/provisioning-orchestrator/src/migrations`; only the hand-curated kind bootstrap list omitted it.

## Verify
- [x] Black-box suite green; the bootstrap probe now creates the backup-scope tables (bbx-595-01/02 pass).
- [x] Acceptance: backup scope returns 2xx for an authorized caller; cross-tenant stays 403. Live-verified (2026-06-19, evidence-rerun/16): superadmin `GET /v1/admin/backup/scope` -> 200 (matrix); acme-ops `GET /v1/tenants/{globex}/backup/scope` -> 403.

## Archive
- [ ] `openspec validate fix-backup-scope-schema --strict`; `/opsx:archive fix-backup-scope-schema` after merge.
