# Changelog

## Unreleased

### Breaking changes

- `POST /v1/backup/restore` now returns `schema_version: "2"` with a confirmation token and prechecks instead of dispatching the restore immediately.
- New endpoints: `POST /v1/backup/restore/confirm` and `GET /v1/backup/restore/confirm/:id`.
- Emergency bypass flag: `RESTORE_CONFIRMATION_ENABLED=false` restores the legacy direct-dispatch behavior.
