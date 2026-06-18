# Tasks — fix-backup-scope-schema

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: superadmin `GET /v1/admin/backup/scope` -> 500 `{code:42P01}`; acme-ops `GET /v1/tenants/{globex}/backup/scope` -> 403 (isolation holds).

## Implement (kind runtime AND shippable product as applicable)
- [ ] Add the backup-scope schema (deployment_profile_registry + backup_scope_entries) to the governance/backup migration set.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Backup scope returns 2xx for an authorized caller; cross-tenant stays 403.

## Archive
- [ ] `openspec validate fix-backup-scope-schema --strict`; `/opsx:archive fix-backup-scope-schema` after merge.
