# Tasks

- [x] Test broker acquisition, cache, expiry skew, concurrent refresh and isolation.
- [x] Test revocation, bounded cached-token 401 recovery and rotation rejection.
- [x] Validate auth on collection POST, item PUT and legacy singular PUT.
- [x] Recheck token endpoints, secret references and verified tenant profile access.
- [x] Integrate completions, streams and batch submission/polling through the broker.
- [x] Keep credentials out of stored configs, snapshots, usage and public errors.
- [x] Add nullable auth/version migrations without adding DDL to worker reads.
- [x] Add PostgreSQL 17 migration/compatibility coverage and register tests in CI.
- [x] Preserve existing API-key behavior and document rollout/revocation limits.
- [x] Preserve brokered batch polling, result ingestion and cancellation after
      metadata edits, while re-acquiring under the latest connection version.
- [x] Honor API-key refs restored by the immediately previous registry writer;
      add its exact item PUT SQL to the PostgreSQL compatibility fixture.
- [x] Keep transient token exchange errors retryable and preserve unresolved-secret
      errors during cached-token 401 recovery.
- [x] Bound token exchanges to 30 seconds and response bodies to 64 KiB; prune
      expired entries on cache activity and evict superseded connection versions.
- [x] Capture logs, rows and usage alongside revoked-grant and rejected-bearer
      stream responses; add missing OpenSpec scenarios and pass strict validation.
- [ ] Run PostgreSQL integration in CI; no database is available in the maker sandbox.
- [ ] Run the existing socket-based completion suite in CI; sandbox listen returns EPERM.
- [ ] Separate deployment maker: add opt-in profiles and projected token volume;
      check unchanged default renders, configured audience and absence of secrets.

## Follow-up evidence

Public seams are broker preparation/authorized fetch, executor completion and
streaming, batch reconciliation/cancellation/results, and PostgreSQL store reads.
Before fixing source, `node tests/blackbox/llm-provider-credential-broker.test.mjs`
reproduced a missing paid-batch poll (one provider call instead of two), stale
broker auth after a restored API-key ref, and a 503 instead of the required 500
during 401 recovery. `node tests/unit/provider-credential-broker.test.mjs`
reproduced permanent 424s for transient exchanges, reuse of superseded entries,
missing exchange deadlines and acceptance of oversized token responses.

The batch cause was comparing the snapshot version to a version regenerated on
every PUT. The mixed-version cause was preferring additive auth columns that the
old registry SQL never updates. The error causes were a catch-all 424 mapping and
an untyped secret-resolution error remapped by the provider transport.

All 25 broker unit/executor scenarios pass, as do seven adapter contract files.
The CI LLM provider selection passes 20 of 22 files with the correct chart path.
The remaining completion-routes and Vault store suites cannot listen in this
sandbox (`listen EPERM: operation not permitted 127.0.0.1`); PR CI must run them.
PostgreSQL coverage is skipped because `LLM_CONNECTIONS_TEST_DATABASE_URL` is absent
and no PostgreSQL 17 is installed. Strict OpenSpec validation passes. No chart,
workflow pin, deployment, dependency or lockfile changes are part of this follow-up.

## CI repair evidence

The published `http-idempotency` failure reproduced a fresh-schema column-order
regression: broker columns preceded `cancel_fence`, so the existing positional
duplicate insert assigned a boolean to `auth` (42804 instead of 23505). Append
the nullable broker columns after all legacy columns to preserve that insert.
The PostgreSQL test remains unchanged. Local integration runs skip because the
test database URLs are absent; no PostgreSQL server is installed and Docker
socket access is denied. CI must verify the migration on PostgreSQL 17.

Before the image fix, `node tests/blackbox/flows-worker-dockerfile.test.mjs`
failed both transitive-module checks because the image omitted `provider-auth.mjs`
and `provider-credential-broker.mjs`. Add both to the existing COPY allow-list.
All six checks now pass, including the actual build guard's missing-module
rejection. The four-file CI image-contract selection, broker unit tests, broker
executor tests and batch tests pass. No existing tests or CI gates were changed.
The full `pnpm test:unit` run also encounters sandbox-only `listen EPERM` errors
and missing chart files at the required sibling `../falcone-charts` path. These
checks require the CI checkout layout and socket permissions.
