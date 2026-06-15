## ADDED Requirements

### Requirement: Real-stack document-store E2E suite against FerretDB on kind

The system SHALL provide a Playwright E2E suite that validates document CRUD
(`POST /v1/collections/{name}/documents`, `GET /v1/collections/{name}/documents`,
`PUT /v1/collections/{name}/documents/{id}`, `DELETE /v1/collections/{name}/documents/{id}`),
query (`POST /v1/collections/{name}/query`), and aggregation
(`POST /v1/collections/{name}/search`) against a FerretDB gateway
(`ghcr.io/ferretdb/ferretdb:2.7.0`) and DocumentDB engine
(`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`) backend
deployed by `tests/e2e/stack.sh` on the kind test cluster.

> **Known out-of-scope:** the Mongo change-stream realtime path
> (`apps/control-plane/src/runtime/realtime-executor.mjs:54,66` — `collMod
> changeStreamPreAndPostImages` + `collection.watch()`) returns
> CommandNotSupported(115) / UnknownBsonField(40415) on FerretDB 2.7.0. All
> `tests/e2e/realtime/` specs exercise this path and are NOT included in this
> requirement. They are tracked on `add-ferretdb-realtime-cdc-remediation`.

#### Scenario: Create document returns HTTP 201 with a document ID
- **WHEN** an authenticated Tenant A request is sent to `POST /v1/collections/{name}/documents` with a valid JSON body
- **THEN** the response status is 201 and the response body contains a document `id` field

#### Scenario: List documents returns the created document
- **WHEN** an authenticated Tenant A request is sent to `GET /v1/collections/{name}/documents` after a document has been created in that collection
- **THEN** the response status is 200 and the response body contains an array that includes the previously created document

#### Scenario: Update document returns HTTP 200 with updated fields
- **WHEN** an authenticated Tenant A request is sent to `PUT /v1/collections/{name}/documents/{id}` with a valid JSON body replacing a previously created document
- **THEN** the response status is 200 and a subsequent `GET /v1/collections/{name}/documents` returns the updated field values

#### Scenario: Delete document returns HTTP 200 and document is absent on subsequent list
- **WHEN** an authenticated Tenant A request is sent to `DELETE /v1/collections/{name}/documents/{id}` for an existing document
- **THEN** the response status is 200 and a subsequent `GET /v1/collections/{name}/documents` does not include that document

#### Scenario: Query returns only matching documents
- **WHEN** an authenticated Tenant A request is sent to `POST /v1/collections/{name}/query` with a filter that matches a known subset of documents
- **THEN** the response status is 200 and the response body contains only documents satisfying the filter

#### Scenario: Unauthenticated request is rejected
- **WHEN** a request without authentication credentials is sent to `GET /v1/collections/{name}/documents`
- **THEN** the response status is 401

---

### Requirement: Aggregation pipeline — adapter-allowed stages pass affirmatively on FerretDB

The system SHALL execute all adapter-allowed aggregation stages via
`POST /v1/collections/{name}/search` against the FerretDB + DocumentDB backend
and return a correct computed result. The ADR-14 spike confirmed all 15
adapter-allowed stages are supported on FerretDB 2.7.0; defensive skip-on-error
hedges are not used. Only `$out` and `$merge` are expected to be blocked by the
adapter allowlist (not by FerretDB itself). Cross-DB `$lookup`
(Location40321) is expected to be rejected by the engine.

#### Scenario: Aggregation pipeline with $match and $group returns computed result
- **WHEN** an authenticated Tenant A request is sent to `POST /v1/collections/{name}/search` with a pipeline containing `$match` and `$group` with `$sum`
- **THEN** the response status is 200 and the response body contains an aggregated result with exact numeric totals consistent with the seeded documents

#### Scenario: Aggregation pipeline with $avg returns exact numeric result
- **WHEN** an authenticated Tenant A request is sent to `POST /v1/collections/{name}/search` with a pipeline containing `$group` with `$avg` over a numeric field
- **THEN** the response status is 200 and the computed average matches the expected value derived from the seeded documents (mixed-numeric $avg is exact on FerretDB 2.7.0)

#### Scenario: Aggregation pipeline with $sort and $limit returns correctly ordered subset
- **WHEN** an authenticated Tenant A request is sent to `POST /v1/collections/{name}/search` with a pipeline containing `$sort` descending and `$limit 3`
- **THEN** the response status is 200 and the response body contains at most 3 documents in descending order by the sort field

#### Scenario: $out stage is rejected by the adapter allowlist
- **WHEN** an authenticated Tenant A request is sent to `POST /v1/collections/{name}/search` with a pipeline containing `$out`
- **THEN** the response status is 400 or 403 (adapter allowlist blocks the stage before reaching the engine)

#### Scenario: Cross-DB $lookup is rejected by the engine with Location40321
- **WHEN** an authenticated Tenant A request is sent to `POST /v1/collections/{name}/search` with a pipeline containing a `$lookup` referencing a collection in a different database
- **THEN** the response status is 400 and the response body contains an error indicating Location40321 or equivalent cross-database lookup rejection

---

### Requirement: Vector-index management via the wired route on FerretDB

The system SHALL support vector-index creation and deletion via
`POST /v1/collections/{name}/vector-indexes` and
`DELETE /v1/collections/{name}/vector-indexes/{indexName}` against the
FerretDB + DocumentDB backend. The DocumentDB engine bundles pgvector 0.8.1.
There is NO `/v1/collections/{name}/indexes` route in the public route catalog.

#### Scenario: Vector-index creation returns HTTP 200
- **WHEN** an authenticated structural_admin request is sent to `POST /v1/collections/{name}/vector-indexes` with a valid vector-index definition
- **THEN** the response status is 200 (or 201) and the index is reflected in subsequent queries using the indexed vector field

#### Scenario: Vector-index deletion returns HTTP 200
- **WHEN** an authenticated structural_admin request is sent to `DELETE /v1/collections/{name}/vector-indexes/{indexName}` for a previously created index
- **THEN** the response status is 200

---

### Requirement: Multi-document transaction returns deterministic unsupported error on FerretDB

The system SHALL, when a multi-document transaction is attempted against the
FerretDB + DocumentDB backend, return a deterministic error indicating
CommandNotFound(59) on `commitTransaction`. No atomic rollback is guaranteed:
`abortTransaction` is a silent no-op on FerretDB 2.7.0.

#### Scenario: commitTransaction returns CommandNotFound(59)
- **WHEN** a client initiates a multi-document transaction and sends `commitTransaction` to the FerretDB-backed document store
- **THEN** the response contains an error code 59 (CommandNotFound) and the request does not succeed as an atomic transaction

#### Scenario: No atomic rollback on abortTransaction
- **WHEN** a client calls `abortTransaction` after writing documents within a transaction against the FerretDB backend
- **THEN** the written documents are not guaranteed to be absent (silent no-op); the spec asserts the absence of an error response, not rollback semantics

---

### Requirement: Per-tenant document-store isolation validated through the data API

The system SHALL enforce that Tenant B cannot read or write documents belonging
to Tenant A's collections, as validated by a cross-tenant Playwright probe using
the canonical A/B tenant fixtures (`tests/e2e/helpers/flows/tenant-fixtures.ts`).
Isolation is enforced by app-layer tenantId scoping; per-database role scoping
is NOT enforced at the FerretDB/DocumentDB layer. All probes MUST exercise the
HTTP data API — direct-to-engine reads are not isolated and are not a valid test
surface.

#### Scenario: Tenant B cannot see Tenant A's documents in a collection listing
- **WHEN** Tenant B sends `GET /v1/collections/{name}/documents` using Tenant B's identity headers, where `{name}` is a collection that Tenant A has written documents into during the same test run
- **THEN** the response body does not contain any document created by Tenant A (app-layer tenantId scoping enforces this at the API level; direct-to-engine reads are not isolation-tested)

#### Scenario: Tenant B query returns no results for Tenant A's documents
- **WHEN** Tenant B sends `POST /v1/collections/{name}/query` with a filter that would match Tenant A's documents, using Tenant B's identity headers
- **THEN** the response status is 200 with an empty result set, or the response status is 403 or 404

#### Scenario: Tenant B cannot create documents in Tenant A's collection
- **WHEN** Tenant B sends `POST /v1/collections/{name}/documents` targeting a collection owned by Tenant A, using Tenant B's identity headers
- **THEN** the response status is 403 or 404 (access denied or resource not found for the requesting tenant)

---

### Requirement: FerretDB + DocumentDB stack wiring with ENGINE-FIRST readiness ordering

The system SHALL deploy the FerretDB gateway and DocumentDB engine into the
ephemeral E2E namespace via `tests/e2e/stack.sh up` when
`E2E_DOCUMENT_BACKEND=ferretdb` is set, with the DocumentDB engine deployed
and rolled out to Ready before the FerretDB gateway is installed (ENGINE-FIRST
ordering). Both images shall be pre-pulled into the kind node cache before Helm
install. The stack SHALL always delete the ephemeral namespace on `stack.sh down`
via the mandatory EXIT/INT/TERM teardown trap.

#### Scenario: stack.sh up deploys DocumentDB engine before FerretDB gateway
- **WHEN** `stack.sh up` is invoked with `E2E_DOCUMENT_BACKEND=ferretdb`
- **THEN** the DocumentDB engine (`ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0`) Deployment/StatefulSet rollout completes and all its pods report Ready before the FerretDB gateway (`ghcr.io/ferretdb/ferretdb:2.7.0`) Helm release is installed

#### Scenario: stack.sh up gates on all pods Ready before test runner is invoked
- **WHEN** `stack.sh up` is invoked with `E2E_DOCUMENT_BACKEND=ferretdb`
- **THEN** the script does not proceed to the port-forward or smoke-check step until all Deployments and StatefulSets in the ephemeral namespace (including both FerretDB components) report all pods Ready

#### Scenario: stack.sh down always deletes the ephemeral namespace
- **WHEN** `stack.sh down` is invoked (including via the EXIT/INT/TERM trap)
- **THEN** the ephemeral namespace is deleted and no pods remain, regardless of whether the E2E specs passed or failed

---

### Requirement: Per-issue E2E runner path for FerretDB document-store change

The system SHALL provide a per-issue runner path so that
`bash tests/e2e/run-issue.sh add-ferretdb-document-store-e2e` executes
`tests/e2e/specs/issues/add-ferretdb-document-store-e2e.spec.ts` covering
document CRUD, query, aggregation, vector-index, transaction error, auth, and
cross-tenant isolation scenarios, with the mandatory teardown trap active.
The Mongo change-stream realtime suite (`tests/e2e/realtime/`) is NOT included
in this runner path.

#### Scenario: Per-issue runner executes document-store specs and tears down the namespace
- **WHEN** `bash tests/e2e/run-issue.sh add-ferretdb-document-store-e2e` is run
- **THEN** only `specs/issues/add-ferretdb-document-store-e2e.spec.ts` (covering all document-store scenario blocks) is executed via Playwright and the ephemeral namespace is torn down after completion regardless of outcome
