## Context

Document-store routes are wired in the control-plane and backed by MongoDB
today (`apps/control-plane/src/runtime/main.mjs::mongoUri`). The FerretDB
migration changes (`add-ferretdb-gateway`, `add-ferretdb-documentdb-engine`,
`add-ferretdb-data-access-cutover`) replace the backend while keeping the wire
protocol identical. The ADR-14 spike ran against FerretDB 2.7.0 /
postgres-documentdb:17-0.107.0-ferretdb-2.7.0 and produced the authoritative
compatibility matrix used throughout this design.

Routes confirmed in `services/gateway-config/public-route-catalog.json`:
- `POST   /v1/collections/{name}/documents`   (data_access)
- `GET    /v1/collections/{name}/documents`   (data_access)
- `PUT    /v1/collections/{name}/documents/{id}` (data_access)
- `DELETE /v1/collections/{name}/documents/{id}` (data_access)
- `POST   /v1/collections/{name}/query`       (data_access)
- `POST   /v1/collections/{name}/search`      (data_access)
- `POST   /v1/collections/{name}/vector-indexes` (structural_admin)
- `DELETE /v1/collections/{name}/vector-indexes/{indexName}` (structural_admin)

There is NO `/v1/collections/{name}/indexes` route. Any index behavior is
exercised through `/v1/collections/{name}/vector-indexes` only.

The E2E harness (`tests/e2e/stack.sh`, `run.sh`, `run-issue.sh`) is
operational for flows, MCP, and storage suites. Canonical A/B tenant fixtures
are in `tests/e2e/helpers/flows/tenant-fixtures.ts`. No document-store
Playwright specs exist today.

## Out-of-Scope: Realtime/CDC Suite (separate, pgoutput-based, owned by #460)

`add-ferretdb-realtime-cdc-remediation` (#460, MERGED) re-architected realtime onto a
Postgres pgoutput logical-replication slot. `apps/control-plane/src/runtime/
realtime-executor.mjs` no longer calls `collection.watch()` — it consumes a
`WalReplicationClient` against the DocumentDB engine, with tenant isolation enforced
consumer-side. The `tests/e2e/realtime/` specs are now pgoutput-based and owned by #460.
They are a SEPARATE suite and out of scope for this document-store change, which neither
runs nor modifies them. (Mongo change streams were only ever unsupported on FerretDB —
CommandNotSupported(115) / UnknownBsonField(40415) — which is exactly why #460 removed
that path.)

## Known-Limitation Scope: Multi-Document Transactions

FerretDB 2.7.0 returns CommandNotFound(59) on `commitTransaction`; `abortTransaction`
is a silent no-op. Specs that exercise transactions MUST assert these deterministic
error codes and MUST NOT assert atomic rollback behavior.

## Goals / Non-Goals

**Goals:**
- Author Playwright specs covering document CRUD, list, query, aggregation
  (adapter-allowed stages affirmatively), vector-index creation/deletion,
  transaction unsupported error assertion, auth rejection, and cross-tenant
  isolation probe (A/B via the data API).
- Wire the FerretDB + DocumentDB two-layer Helm stack into `stack.sh up` with
  ENGINE-FIRST readiness ordering (DocumentDB engine pods Ready before FerretDB
  gateway pods are checked).
- Provide per-issue runner path (`run-issue.sh add-ferretdb-document-store-e2e`).
- All specs assert only routes present in the public route catalog.

**Non-Goals:**
- Running or modifying any `tests/e2e/realtime/` spec (out of scope; blocked
  on `add-ferretdb-realtime-cdc-remediation`).
- Implementing new document-store routes.
- Modifying any source code outside `tests/e2e/`.
- Data migration or schema validation (separate changes).
- Asserting that transactions succeed atomically (unsupported on FerretDB 2.7.0).

## Decisions

**D1 — Spec placement follows `run-issue.sh` convention.**
`run-issue.sh <change-id>` resolves to `specs/issues/<change-id>.spec.ts`. The
document-store E2E entry point is
`tests/e2e/specs/issues/add-ferretdb-document-store-e2e.spec.ts`. Shared
helpers and per-operation spec blocks live in
`tests/e2e/specs/document-store/`.

**D2 — Reuse canonical A/B tenant fixtures without duplication.**
`tests/e2e/helpers/document-store/tenant-fixtures.ts` re-exports `TENANT_A`
and `TENANT_B` from `tests/e2e/helpers/flows/tenant-fixtures.ts`, plus a
`collectionName(scenario: string): string` helper for deterministic, stable
collection names scoped to the test run. Matches the MCP/storage fixture
pattern.

**D3 — Reuse the existing `E2E_FERRETDB` stack wiring (ENGINE-FIRST, additive).**
`stack.sh up` already deploys FerretDB when `E2E_FERRETDB=true`: it provisions the
`in-falcone-documentdb` / `in-falcone-documentdb-replication` secrets and the
`documentdb` + `ferretdb` sub-charts of the in-falcone chart are enabled by the FerretDB
values overlay (`tests/e2e/values-ferretdb-realtime-e2e.yaml`). ENGINE-FIRST ordering is
enforced by the chart's DocumentDB readiness dependency; the existing `healthy()` gate
then waits on EVERY Deployment and StatefulSet (covering both FerretDB components) before
the runner is invoked. This change only ADDS the two FerretDB image pre-pulls (best-effort
`docker pull` + `kind load`) and inline comments — it does NOT add a separate
`E2E_DOCUMENT_BACKEND` block or separate Helm releases. The teardown trap
(`kubectl delete namespace "$NS"`) covers all namespace-scoped resources.

**D4 — Specs skip gracefully when the document-store API is not wired.**
Each `test.describe` block includes a `beforeAll` probe against
`GET /v1/collections/e2e-probe/documents` or
`POST /v1/collections/e2e-probe/documents` and calls `test.skip` with a
descriptive reason if the probe returns 404 or 501. Mirrors the live-gate
pattern in `tests/e2e/specs/mcp/mcp-cross-tenant.spec.ts:34`.

**D5 — Aggregation specs are affirmative, not defensive.**
The spike confirmed all 15 adapter-allowed aggregation stages pass on FerretDB
2.7.0. Specs assert actual computed results — no "skip on unsupported operator"
hedges. Only `$out` and `$merge` are expected-blocked (adapter allowlist, not
FerretDB limitation). A separate scenario asserts cross-DB `$lookup` is
rejected with Location40321.

**D6 — Vector-index behavior tested via the wired route only.**
Index creation/deletion is exercised through
`POST /v1/collections/{name}/vector-indexes` and
`DELETE /v1/collections/{name}/vector-indexes/{indexName}`. These routes are
structural_admin privilege; specs use a structural_admin API key. The
DocumentDB engine bundles pgvector 0.8.1, so vector-index creation is
expected to succeed. There is no generic `indexes` route.

**D7 — Transaction spec asserts deterministic unsupported error.**
If a transaction spec exists, it MUST call `commitTransaction` and assert the
response error code is 59 (CommandNotFound). It MUST NOT assert that documents
are absent after the failed commit (no rollback guarantee).

**D8 — Cross-tenant probe exercises the data API only, never the raw Mongo wire.**
Per-database role scoping is NOT enforced at the FerretDB/DocumentDB layer;
app-layer tenantId scoping is the authoritative boundary. Cross-tenant probes
MUST go through the HTTP data API. A note is added to each isolation scenario
documenting that direct-to-engine reads are not isolated and that the API is
the only authoritative test surface.

**D9 — Realtime is explicitly out of scope with a clear note.**
The issue spec comments that `tests/e2e/realtime/` is a SEPARATE, pgoutput-based suite
owned by `add-ferretdb-realtime-cdc-remediation` (#460, MERGED) — `realtime-executor.mjs`
no longer uses `collection.watch()` — and is neither run nor modified here.

## Risks / Trade-offs

- [Risk: FerretDB images not in kind node cache] Mitigation: `stack.sh` pre-pulls
  both images and loads them into the kind cluster before helm install.
- [Risk: ENGINE-FIRST ordering fragile under helm] Mitigation: explicit `helm
  upgrade --wait` on the DocumentDB engine release before the FerretDB gateway
  release is installed; `--timeout 120s` added to each.
- [Risk: pgvector extension not active] Mitigation: DocumentDB engine image
  bundles pgvector 0.8.1; vector-index spec includes a `beforeAll` gate that
  skips if the vector-index route returns a non-2xx for a test creation.
- [Risk: cross-tenant isolation relies on API-layer tenantId scoping] Documented
  in D8; direct-to-engine bypass is not in scope for E2E testing.
