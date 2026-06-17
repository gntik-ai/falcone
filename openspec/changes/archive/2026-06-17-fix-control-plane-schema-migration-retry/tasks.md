# Tasks — fix-control-plane-schema-migration-retry

## Implementation
- [x] Boot migration entry point: `deploy/kind/control-plane/server.mjs` (the `in-falcone-control-plane`
  image), which ran `ensureSchema -> ensureSagaSchema -> recoverSagas` once and only `.catch`-logged
  on failure while the server listened anyway (not `apps/control-plane/` — that's the executor runtime).
- [x] Extracted `runWithRetry` + `migrationRetryConfig` into `deploy/kind/control-plane/schema-retry.mjs`
  (testable; injectable now/sleep). Exponential backoff start 1 s, cap 30 s, timeout 5 min — all
  overridable via `SCHEMA_MIGRATION_INITIAL_DELAY_MS` / `_MAX_DELAY_MS` / `_TIMEOUT_MS`. Wired into
  server.mjs around the schema/recovery chain.
- [x] Each attempt logs the attempt number + error message and the next backoff.
- [x] On timeout the helper rethrows and server.mjs `process.exit(1)`s, so Kubernetes restarts the pod.

## Testing
- [x] Unit test (deterministic, injected clock): ECONNREFUSED on first 2 attempts → succeeds on the
  3rd; persistent failure past the timeout rejects after bounded attempts (no infinite loop); backoff
  doubles and is capped; config defaults + env overrides.
  `tests/blackbox/control-plane-schema-migration-retry.test.mjs` (4 cases).
- [x] Real-stack proof: the REAL `ensureSchema` wrapped in `runWithRetry` against a real Postgres
  that is still initializing — attempt 1 failed transiently ("Connection terminated unexpectedly"),
  retried, attempt 2 succeeded and created the `tenants` table (`tenants_table_exists=true
  succeeded_on_attempt=2`). (POST /v1/tenants → 201 follows from the table existing; a full HTTP
  control-plane needs Keycloak/JWKS + many env, out of scope for this slice.)
- [x] `bash tests/blackbox/run.sh` → 655/655.

## Archive
- [ ] `/opsx:archive fix-control-plane-schema-migration-retry`
