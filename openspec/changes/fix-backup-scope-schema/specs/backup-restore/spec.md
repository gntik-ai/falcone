# backup-restore — spec delta for fix-backup-scope-schema

## ADDED Requirements

### Requirement: Backup-scope schema is provisioned at control-plane boot

The system SHALL provision the backup-scope schema — `deployment_profile_registry` and
`backup_scope_entries` (migration 114) — as part of the governance schema bootstrap, so that the
backup-scope read actions (`backup-scope-get`, `tenant-backup-scope-get`) resolve their relations
instead of failing with PostgreSQL `42P01` (undefined_table). The migration SHALL be applied after
its prerequisites: migration 097 (which defines `set_updated_at_timestamp()`, used by the
backup-scope triggers) and migration 104 (which creates `boolean_capability_catalog`, seeded by
migration 114). The bootstrap SHALL remain idempotent (re-running boot is a no-op).

#### Scenario: backup scope returns a business response for an authorized caller

- **WHEN** a superadmin calls `GET /v1/admin/backup/scope` on a freshly bootstrapped control-plane
- **THEN** the response is `2xx` with the backup-scope matrix (no `42P01` undefined_table error)

#### Scenario: tenant backup scope stays tenant-isolated

- **WHEN** a tenant operator calls `GET /v1/tenants/{otherTenantId}/backup/scope` for a tenant it does not own
- **THEN** the response is `403` (cross-tenant access denied)

#### Scenario: bootstrap applies migration 114 after its prerequisites

- **WHEN** the governance schema bootstrap runs
- **THEN** migration 114 (backup-scope) is applied, ordered after migration 097 and migration 104
