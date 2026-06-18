# backup-restore — spec delta for fix-backup-scope-schema

## ADDED Requirements

### Requirement: Backup scope API 500s on missing schema tables

The system SHALL ensure that backup scope API 500s on missing schema tables: Add the backup-scope schema (deployment_profile_registry + backup_scope_entries) to the governance/backup migration set.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Backup scope returns 2xx for an authorized caller
