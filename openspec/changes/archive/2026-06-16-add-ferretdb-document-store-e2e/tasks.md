## 1. Tenant Fixtures and Helpers

- [x] 1.1 Create `tests/e2e/helpers/document-store/tenant-fixtures.ts` that
  re-exports `TENANT_A`, `TENANT_B`, and `controlPlaneBaseUrl` from
  `tests/e2e/helpers/flows/tenant-fixtures.ts`, plus a
  `collectionName(scenario: string): string` helper for deterministic, stable
  collection names scoped to the test run (e.g. `e2e-${scenario}-${Date.now()}`)
- [x] 1.2 Create `tests/e2e/helpers/document-store/document-api-client.ts` with
  typed wrappers for the wired document-store routes confirmed in
  `services/gateway-config/public-route-catalog.json`:
  `createDocument`, `listDocuments`, `updateDocument`, `deleteDocument`,
  `queryDocuments`, `aggregateDocuments` (POST /search), `createVectorIndex`,
  `deleteVectorIndex` — each accepting
  `(ctx: APIRequestContext, baseUrl: string, identity: TenantIdentity, collection: string, ...params)`
- [x] 1.3 Create `tests/e2e/helpers/document-store/document-gate.ts` with a
  `probeDocumentApi(ctx, baseUrl, identity, collection)` function that sends
  `GET /v1/collections/{collection}/documents` and returns
  `{ available: boolean, reason: string }` for use as a live gate in
  `test.beforeAll`. Mirrors the live-gate pattern in
  `tests/e2e/specs/mcp/mcp-cross-tenant.spec.ts:34`

## 2. Document CRUD E2E Specs

- [x] 2.1 Create `tests/e2e/specs/document-store/document-create.spec.ts` —
  `test.describe('document-store: create document', ...)` with `mode: serial`;
  gate on `probeDocumentApi`; assert `POST /v1/collections/{name}/documents`
  returns 201 and a body containing a document `id` for Tenant A
  (scenario `DOC-E2E-001`)
- [x] 2.2 Create `tests/e2e/specs/document-store/document-list.spec.ts` —
  create a document in `beforeAll`; assert `GET /v1/collections/{name}/documents`
  returns 200 and the body contains an array including the created document;
  clean up in `afterAll` (scenario `DOC-E2E-002`)
- [x] 2.3 Create `tests/e2e/specs/document-store/document-update.spec.ts` —
  create a document in `beforeAll`; assert
  `PUT /v1/collections/{name}/documents/{id}` returns 200 and a subsequent
  `GET` returns the updated field values; clean up in `afterAll`
  (scenario `DOC-E2E-003`)
- [x] 2.4 Create `tests/e2e/specs/document-store/document-delete.spec.ts` —
  create a document in `beforeAll`; assert
  `DELETE /v1/collections/{name}/documents/{id}` returns 200 and the document
  is absent in a subsequent `GET`; clean up in `afterAll`
  (scenario `DOC-E2E-004`)
- [x] 2.5 Create `tests/e2e/specs/document-store/document-query.spec.ts` —
  create known documents in `beforeAll`; assert
  `POST /v1/collections/{name}/query` with a filter returns 200 and only
  matching documents; clean up in `afterAll` (scenario `DOC-E2E-005`)
- [x] 2.6 Create `tests/e2e/specs/document-store/document-auth.spec.ts` —
  assert that an unauthenticated request to
  `GET /v1/collections/{name}/documents` returns 401 and a request with an
  invalid API key returns 401 or 403 (scenario `DOC-E2E-006`)

## 3. Aggregation Specs (Affirmative — No Defensive Skips)

- [x] 3.1 Create `tests/e2e/specs/document-store/document-aggregation.spec.ts` —
  seed known documents in `beforeAll`; gate on `probeDocumentApi`
- [x] 3.2 In `document-aggregation.spec.ts`: assert
  `POST /v1/collections/{name}/search` with `[$match, $group: {$sum}]` returns
  200 and exact numeric totals (scenario `DOC-E2E-AGG-001`). Do NOT add
  skip-on-error guards — the spike confirmed $sum/$avg are exact on FerretDB 2.7.0
- [x] 3.3 Add `$avg` pipeline assertion returning the expected average
  (scenario `DOC-E2E-AGG-002`)
- [x] 3.4 Add `$sort` + `$limit` pipeline assertion returning a correctly ordered
  subset of at most N documents (scenario `DOC-E2E-AGG-003`)
- [x] 3.5 Add `$out` stage scenario: assert the response is 400 or 403 (adapter
  allowlist blocks it before reaching the engine; scenario `DOC-E2E-AGG-004`)
- [x] 3.6 Add cross-DB `$lookup` scenario: assert the response is 400 and the
  error body contains Location40321 or an equivalent cross-database rejection
  (scenario `DOC-E2E-AGG-005`)

## 4. Vector-Index Specs

- [x] 4.1 Create `tests/e2e/specs/document-store/document-vector-index.spec.ts` —
  use a structural_admin API key; include a `beforeAll` gate that attempts
  `POST /v1/collections/{name}/vector-indexes` with a minimal definition and
  skips the suite if the response is non-2xx (confirms pgvector is active)
- [x] 4.2 Assert `POST /v1/collections/{name}/vector-indexes` returns 200 or 201
  (scenario `DOC-E2E-IDX-001`). Route confirmed in
  `services/gateway-config/public-route-catalog.json` (structural_admin)
- [x] 4.3 Assert `DELETE /v1/collections/{name}/vector-indexes/{indexName}` for
  the previously created index returns 200 (scenario `DOC-E2E-IDX-002`)
- [x] 4.4 Do NOT author any spec targeting `PUT /v1/collections/{name}/indexes` —
  that route does not exist in the public route catalog

## 5. Transaction Unsupported Error Spec

- [x] 5.1 Create `tests/e2e/specs/document-store/document-transaction.spec.ts` —
  gate on `probeDocumentApi`; initiate a multi-document transaction and call
  `commitTransaction`; assert the error code is 59 (CommandNotFound) and the
  operation does not succeed as an atomic transaction
  (scenario `DOC-E2E-TXN-001`)
- [x] 5.2 Add `abortTransaction` scenario: assert the response does not return an
  error (silent no-op); do NOT assert rollback semantics (documents may remain)
  (scenario `DOC-E2E-TXN-002`)

## 6. Cross-Tenant Isolation Probe

- [x] 6.1 Create `tests/e2e/specs/document-store/document-cross-tenant.spec.ts` —
  `test.describe('document-store: cross-tenant isolation', ...)` with
  `mode: serial`; add a comment noting that isolation is enforced by app-layer
  tenantId scoping and that all probes MUST go through the HTTP data API (direct-to-engine
  reads are not isolated and are not a valid test surface)
- [x] 6.2 Tenant A creates a document in `beforeAll`; Tenant B sends
  `GET /v1/collections/{name}/documents` for Tenant A's collection and the
  response must not contain Tenant A's document (scenario `DOC-E2E-XT-01`)
- [x] 6.3 Tenant B sends `POST /v1/collections/{name}/query` targeting Tenant A's
  collection with a filter matching Tenant A's document; assert the response body
  contains no results or the status is 403/404 (scenario `DOC-E2E-XT-02`)
- [x] 6.4 Tenant B attempts to create a document in Tenant A's collection via
  `POST /v1/collections/{name}/documents`; assert the response status is 403 or
  404 (scenario `DOC-E2E-XT-03`); clean up Tenant A's documents in `afterAll`

## 7. Issue Entry-Point Spec

- [x] 7.1 Create `tests/e2e/specs/issues/add-ferretdb-document-store-e2e.spec.ts`
  that imports and re-runs all document-store spec blocks (create, list, update,
  delete, query, aggregation, vector-index, transaction error, auth, cross-tenant)
  so that `bash tests/e2e/run-issue.sh add-ferretdb-document-store-e2e` exercises
  the full document-store suite in a single Playwright run
- [x] 7.2 Add an explicit comment in the issue spec: "Realtime/CDC suite
  (tests/e2e/realtime/) is a SEPARATE, pgoutput-based suite owned by
  add-ferretdb-realtime-cdc-remediation (#460, MERGED) — realtime-executor.mjs no
  longer uses collection.watch(); this document-store change neither runs nor
  modifies it."

## 8. FerretDB Stack Wiring (reuse existing E2E_FERRETDB; ENGINE-FIRST)

- [x] 8.1 Under the EXISTING `E2E_FERRETDB=true` block in `tests/e2e/stack.sh up`,
  add best-effort pre-pull of the DocumentDB engine image
  (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`) and FerretDB
  gateway image (`ghcr.io/ferretdb/ferretdb:2.7.0`) via `docker pull` +
  `kind load docker-image`, mirroring the SeaweedFS pre-pull (non-fatal `|| true`)
- [x] 8.2 Confirm the FerretDB deploy uses the in-falcone chart's `documentdb` +
  `ferretdb` sub-charts (enabled by `tests/e2e/values-ferretdb-realtime-e2e.yaml`
  passed via `E2E_HELM_VALUES`), NOT a separate `E2E_DOCUMENT_BACKEND` block or
  separate Helm releases; ENGINE-FIRST ordering is enforced by the chart's
  DocumentDB readiness dependency. Add an inline comment noting this
- [x] 8.3 Confirm that the existing `healthy()` gate in `stack.sh` (iterates all
  Deployments and StatefulSets) already covers both FerretDB components; add an
  inline comment noting this
- [x] 8.4 Verify `stack.sh down` teardown trap deletes the namespace including
  both FerretDB components — the existing `kubectl delete namespace "$NS"` call
  covers this; add an inline comment noting FerretDB gateway and DocumentDB engine
  are namespace-scoped and torn down with the namespace

## 9. Validation

- [x] 9.1 Run `openspec validate add-ferretdb-document-store-e2e --strict` and
  fix any reported issues until the result is clean
- [x] 9.2 Verify that `bash tests/e2e/run-issue.sh add-ferretdb-document-store-e2e`
  resolves to `specs/issues/add-ferretdb-document-store-e2e.spec.ts` without
  modification to `run-issue.sh`
- [x] 9.3 Confirm that the live-gate `test.skip` path is exercised in a dry run
  (no kind cluster required) by running
  `npx playwright test specs/issues/add-ferretdb-document-store-e2e.spec.ts --reporter=list`
  and observing that all tests skip cleanly with the document-store gate reason
- [x] 9.4 On the kind test cluster (`test-cluster-b`,
  `KUBECONFIG=./kubeconfig-test-cluster-b.yaml`): all document-store scenarios
  (CRUD, aggregation, vector-index, transaction error, cross-tenant) run GREEN
  against the live FerretDB + DocumentDB deployment; the ephemeral namespace is
  torn down after the run
- [x] 9.5 Confirm that NO `tests/e2e/realtime/` specs are run as part of this
  change; if accidentally included, remove them and raise on
  `add-ferretdb-realtime-cdc-remediation`
