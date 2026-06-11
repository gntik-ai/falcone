## ADDED Requirements

### Requirement: MongoDB document CRUD plans are executed against the workspace database

The system SHALL execute the command plan produced by `buildMongoDataApiPlan` against
the workspace MongoDB via the real `mongodb` driver so that `list`, `get`, `insert`,
`update`, `replace`, and `delete` requests return real data or effect real mutations.

#### Scenario: Insert then list returns the inserted document

- **WHEN** a caller with a valid tenant identity inserts a document into a workspace
  collection via `POST /v1/mongo/workspaces/{wid}/data/{db}/collections/{coll}/documents`
  and then lists documents via `GET` on the same path
- **THEN** the list response contains the inserted document and the insert response
  returns the full document including the assigned `_id`

#### Scenario: Get by id returns the document

- **WHEN** a caller requests a specific document via
  `GET /v1/mongo/workspaces/{wid}/data/{db}/collections/{coll}/documents/{id}`
- **THEN** the response contains the matching document and `found` is `true`

### Requirement: Tenant isolation is enforced via adapter-injected filter on every operation

The system SHALL inject the verified `tenantId` predicate into every query filter and
onto every inserted document via `applyTenantScopeToFilter`, so that no document
belonging to another tenant can be read, updated, replaced, or deleted, regardless of
the document identifier supplied by the caller.

#### Scenario: List returns only the caller tenant documents

- **WHEN** two tenants each have documents in the same collection and tenant A calls list
- **THEN** the response contains only tenant A documents and no tenant B documents appear,
  even though they share the same database and collection

#### Scenario: Filter stays within tenant scope

- **WHEN** a caller applies a field filter on a list request
- **THEN** the response contains only documents that match both the caller's tenant
  predicate and the supplied field filter

#### Scenario: Get by id with a cross-tenant id returns not-found

- **WHEN** tenant A requests a document whose `_id` belongs to tenant B
- **THEN** `found` is `false` and no document is returned, because the adapter's
  tenant predicate is merged into the `findOne` filter

#### Scenario: Update targeting a cross-tenant document matches nothing

- **WHEN** tenant A sends an update with the `_id` of a document owned by tenant B
- **THEN** `matched` is 0, the document is not modified, and no error is returned

#### Scenario: Delete targeting a cross-tenant document deletes nothing

- **WHEN** tenant A sends a delete with the `_id` of a document owned by tenant B
- **THEN** `deleted` is 0 and the document remains intact

### Requirement: Insert rejects a forged tenant identity

The system SHALL reject any insert payload where the document's `tenantId` field differs
from the verified caller tenant, returning HTTP 403, so that a caller cannot write data
into another tenant's namespace.

#### Scenario: Insert with a forged tenantId is rejected

- **WHEN** a caller authenticated as tenant A submits an insert with `tenantId` set to
  tenant B inside the document payload
- **THEN** the response status is 403, no document is written, and the total document
  count in the collection remains unchanged

### Requirement: Missing tenant identity returns 401

The system SHALL return HTTP 401 for any Mongo data-API request that arrives without a
resolvable tenant identity (no `x-tenant-id` header and no valid API key), so that
unauthenticated callers cannot access any collection.

#### Scenario: Request with no identity is rejected with 401

- **WHEN** a caller sends a list request to a Mongo data endpoint without providing any
  tenant identity (no JWT headers, no API key)
- **THEN** the response status is 401 and no documents are returned

### Requirement: Driver errors are returned as sanitized HTTP responses

The system SHALL catch all `mongodb` driver errors, log the raw error server-side with
an opaque correlation identifier, and return only the HTTP status and a stable error
`code` without exposing driver internals, query filters, or tenant field values to the
caller.

#### Scenario: Unhandled driver error returns 500 with opaque code

- **WHEN** the `mongodb` driver raises an unexpected error during execution of a plan
- **THEN** the response status is 500, the body contains `code: "MONGO_ERROR"`, and no
  driver message, filter text, or tenant data appears in the response

### Requirement: MongoDB executor is disabled when no URI is configured

The system SHALL return HTTP 501 for any Mongo data-API request when neither `MONGO_URI`
nor `MONGO_HOST` is set, so that deployments without a MongoDB instance fail fast rather
than silently.

#### Scenario: Mongo route returns 501 when executor is not configured

- **WHEN** the control-plane starts without `MONGO_URI` or `MONGO_HOST` set and a caller
  requests a Mongo document endpoint
- **THEN** the response status is 501 with `code: "MONGO_DISABLED"`
