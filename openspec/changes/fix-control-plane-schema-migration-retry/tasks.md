# Tasks — fix-control-plane-schema-migration-retry

## Implementation
- [ ] Locate the boot migration entry point in the control-plane (`apps/control-plane/`).
- [ ] Wrap the migration call in a retry loop with exponential backoff (start: 1 s,
  max-interval: 30 s, timeout: 5 min — all configurable via env).
- [ ] Log each retry attempt with the attempt number and error message.
- [ ] Exit with a non-zero code if the max duration is exceeded.

## Testing
- [ ] Unit test: mock ECONNREFUSED on first 2 calls, succeed on 3rd → migration runs.
- [ ] Integration test (tests/env): start control-plane with Postgres not ready, bring
  Postgres up → migration completes, `POST /v1/tenants` → 201.
- [ ] Run `bash tests/blackbox/run.sh`.
- [ ] Run `/opsx:verify fix-control-plane-schema-migration-retry`.

## Archive
- [ ] `/opsx:archive fix-control-plane-schema-migration-retry`
