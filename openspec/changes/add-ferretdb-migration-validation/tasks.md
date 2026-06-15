## 1. Prerequisites and fixture preparation

- [ ] 1.1 Confirm `add-ferretdb-data-migration-runbook` manifest format (document count + hash vs ObjectId ranges) and document the expected schema in `tests/env/` fixture comments (resolves OQ1).
- [ ] 1.2 Confirm the FerretDB v2 connection port used in `tests/env/` does not collide with the existing MongoDB port; update the fixture env vars accordingly (resolves OQ2).
- [ ] 1.3 Provision two test tenants (A and B) and seed one document per tenant per collection — handled by the smoke runner; parity uses the migration manifest.
- [ ] 1.4 Capture the checksum manifest (document count + content hash per collection per tenant) consumed by the parity checker.
- [ ] 1.5 RESOLVED (ADR-14, merged): transaction commit → CommandNotFound (59); abort is a SILENT NO-OP that does NOT roll back data; CDC watch → CommandNotSupported (115); changeStreamPreAndPostImages → UnknownBsonField (40415). Record these exact codes in waiver messages for tasks 3.5 and 3.6.

## 2. Document-parity checker

- [ ] 2.1 Implement `tests/env/validation/ferretdb-parity-check.mjs` that reads the migration manifest and connects to the FerretDB/DocumentDB endpoint to retrieve per-collection document counts and content hashes for each tenant.
- [ ] 2.2 Implement per-collection comparison: count mismatches (missing document, hash mismatch) and build a structured JSON report; respect a reviewed exception list file if present.
- [ ] 2.3 Implement fallback live-diff mode: when no manifest is provided, compare document counts between the MongoDB source and FerretDB destination endpoints directly.
- [ ] 2.4 Write a failing blackbox test (`tests/blackbox/`) that asserts the parity checker exits 0 when source and destination match and exits non-zero when a document is missing; run `bash tests/blackbox/run.sh` to confirm it is red before 2.5.
- [ ] 2.5 Implement the pass/fail exit-code logic (exit 0 on 100% parity or all exceptions reviewed, exit non-zero otherwise) and confirm the blackbox test turns green.

## 3. Per-tenant document-store-API smoke suite

- [ ] 3.1 Implement `tests/env/validation/ferretdb-smoke-data-api.mjs` that, for each of tenants A and B, exercises `POST /v1/collections/{name}/documents` (insert), `GET /v1/collections/{name}/documents` (list), `POST /v1/collections/{name}/query` (filter + pagination), and `GET /v1/collections/{name}/search` (full-text) through `mongo-data-executor.mjs` against the FerretDB endpoint, asserting HTTP 200/201 with tenant-scoped response bodies.
- [ ] 3.2 Write a failing blackbox test covering each route for both tenants against FerretDB; confirm tests are red before implementing.
- [ ] 3.3 Implement aggregation probes in the smoke suite via `POST /v1/collections/{name}/query`:
  - Same-namespace `$lookup` (≤1 join): MUST return HTTP 200 with correct results; no waiver permitted (SUPPORTED, cap enforced by adapter allowlist).
  - `$facet` (≤4 sub-pipelines): MUST return HTTP 200 with correct results; no waiver permitted (SUPPORTED, cap enforced by adapter allowlist).
  - `$group`: MUST return HTTP 200 with correct results (SUPPORTED).
  - Cross-database `$lookup`: MUST return error code Location40321; assert this exact code and record as confirmed expected outcome per ADR-14.
- [ ] 3.4 Implement index smoke — all index types are SUPPORTED:
  - Unique: insert a duplicate document; assert E11000 error response; no waiver.
  - Compound: create and query against a compound index; assert success; no waiver.
  - Sparse: create a sparse index; assert success; no waiver.
  - TTL: create a TTL index and insert a document; assert index creation and insert both succeed; no waiver for configuration. Do NOT assert background expiry timing (⚠ not code-verifiable within validation window).
- [ ] 3.5 Implement transaction probes (deterministic outcomes per ADR-14):
  - Commit probe: trigger the transaction op in `services/adapters/src/mongodb-data-api.mjs`; assert CommandNotFound with exact error code 59; no "either succeeds" branch permitted.
  - Abort no-op probe: write documents inside a transaction, call abort, then read back the documents; assert the written documents are still present (abort did NOT roll back); record as ADR-14-referenced data-integrity finding.
- [ ] 3.6 Implement CDC probes with pinned error codes (per ADR-14):
  - `watch()` probe: assert CommandNotSupported with exact error code 115; record as ADR-14-referenced finding; pointer to `add-ferretdb-realtime-cdc-remediation`.
  - `changeStreamPreAndPostImages` probe: assert UnknownBsonField with exact error code 40415; record as ADR-14-referenced finding.
  - Mirror structure of `tests/e2e/realtime/tenant-isolation.test.mjs` and `tests/blackbox/cdc-*.test.mjs`. No generic "unsupported" check — exact codes required.
- [ ] 3.7 Implement the cross-tenant NEGATIVE probe in `ferretdb-smoke-data-api.mjs`: use Tenant A credentials to call `GET /v1/collections/{name}/documents` and `POST /v1/collections/{name}/query` where the collection is scoped to Tenant B; assert HTTP 403 or HTTP 404.
- [ ] 3.8 Add teardown hook to `ferretdb-smoke-data-api.mjs` that deletes provisioned test documents for tenants A and B so runs are idempotent (mirror `tests/env/down.sh` pattern).
- [ ] 3.9 Implement isolation-gap probe in `ferretdb-smoke-data-api.mjs`: connect to the FerretDB/DocumentDB backend directly using tenant_a credentials; attempt to read from the tenant_b database namespace (bypassing the Falcone API layer); assert the read SUCCEEDS (confirming no per-database role scoping is enforced); record the gap as an ADR-14-referenced finding. Confirm `apps/control-plane/src/postgres-applier.mjs` has no role/createUser/DocumentDB-identity logic (read-only code check).

## 3b. Engine-first startup

- [ ] 3b.1 Implement startup-ordering enforcement in `run-ferretdb-validation.sh`: start `ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`, poll its health endpoint until healthy, THEN start `ghcr.io/ferretdb/ferretdb:2.7.0`, poll its health endpoint until healthy, THEN begin test execution. Failure of either health-check must abort the suite with a non-zero exit and a clear error message naming which container failed.

## 4. Single-entrypoint runner

- [ ] 4.1 Implement `tests/env/validation/run-ferretdb-validation.sh` that sources `tests/env/env.sh`, runs `ferretdb-parity-check.mjs` then `ferretdb-smoke-data-api.mjs`, collects exit codes, prints a summary (including all ADR-14 waivers), and exits non-zero if either check failed; name the failing check in the output.
- [ ] 4.2 Make `run-ferretdb-validation.sh` executable (`chmod +x`) and verify it can be invoked as `bash tests/env/validation/run-ferretdb-validation.sh`.
- [ ] 4.3 Add `run-ferretdb-validation.sh` invocation to `tests/blackbox/run.sh` behind a guard (`FERRETDB_VALIDATION=1` env flag) so the suite remains green by default and can be activated in CI for FerretDB-backed runs.
- [ ] 4.4 Verify `bash tests/blackbox/run.sh` passes without the guard set (default MongoDB path) and passes with `FERRETDB_VALIDATION=1` when the endpoint points at FerretDB/DocumentDB.

## 5. CI integration

- [ ] 5.1 Add a CI step in the `quality` job that sets `FERRETDB_VALIDATION=1` and the FerretDB connection URI, then runs `bash tests/blackbox/run.sh`; ensure the step is conditional on the FerretDB service being available (job-level flag).
- [ ] 5.2 Add a brief inline comment at the top of `tests/env/validation/run-ferretdb-validation.sh` citing the dependency change IDs (`add-ferretdb-data-access-cutover`, `add-ferretdb-realtime-cdc-remediation`, `add-ferretdb-data-migration-runbook`) and the OQ resolutions from tasks 1.1, 1.2, and 1.5.
- [ ] 5.3 Run `openspec validate add-ferretdb-migration-validation --strict` and confirm it is clean.
