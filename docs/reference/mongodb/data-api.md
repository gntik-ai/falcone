# MongoDB Data API

The MongoDB Data API exposes a workspace-scoped REST surface for tenant-safe document CRUD, bounded bulk write operations, controlled aggregations, JSON import/export flows, topology-aware transactions, change-stream bridge registration, and scoped database/collection credentials for backend consumers.

## Route model

Base collection route:

- `GET /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents`
- `POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents`

Single-document route:

- `GET /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents/{documentId}`
- `PATCH /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents/{documentId}`
- `PUT /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents/{documentId}`
- `DELETE /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents/{documentId}`

Bulk route:

- `POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/bulk/write`

Advanced routes:

- `POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/aggregations`
- `POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/imports`
- `POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/exports`
- `POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/transactions`
- `POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/change-streams`

Scoped credential routes:

- `GET /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/credentials`
- `POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/credentials`
- `GET /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/credentials/{credentialId}`
- `DELETE /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/credentials/{credentialId}`

## Read semantics

Supported read controls:

- validated JSON `filter`
- field-level `projection`
- deterministic `sort`
- cursor pagination with `page[size]` and `page[after]`

### Filters

Supported operators:

- comparisons: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`
- set membership: `$in`, `$nin`
- existence and pattern checks: `$exists`, `$regex`
- nested-array matching: `$elemMatch`
- logical composition: `$and`, `$or`

Example filter payload:

```json
{
  "status": { "$in": ["active", "paused"] },
  "profile.address.city": "Madrid",
  "$or": [
    { "priority": "high" },
    { "score": { "$gte": 10 } }
  ]
}
```

## Write semantics

- `POST` inserts one document.
- `PATCH` applies bounded MongoDB update operators (`$set`, `$unset`, `$inc`, `$push`, `$pull`).
- `PUT` replaces one document.
- `DELETE` removes one document.
- `POST /bulk/write` accepts bounded `insertOne`, `updateOne`, `updateMany`, `replaceOne`, `deleteOne`, and `deleteMany` payloads.
- Mutations require `Idempotency-Key`.

## Scoped credentials

The control plane can mint workspace-governed MongoDB Data API credentials that are limited to one logical database and one or more collections.

Credential scope rules:

- `credentialType` is `api_key` or `token`
- every scope entry must stay inside the requested `{databaseName}`
- every scope entry must declare at least one allowed operation
- collection scope is optional, but recommended for least privilege
- create/revoke operations are idempotency-key protected
- secret values are delivered one time only

Example create payload:

```json
{
  "displayName": "orders-reader",
  "credentialType": "api_key",
  "ttlSeconds": 3600,
  "scopes": [
    {
      "databaseName": "tenant_alpha_main",
      "collectionName": "customer_orders",
      "allowedOperations": ["list", "get", "aggregate", "export"]
    }
  ]
}
```

## Aggregations

Controlled aggregation pipelines support a bounded subset of MongoDB stages:

- allowed stages: `$match`, `$project`, `$sort`, `$limit`, `$skip`, `$group`, `$unwind`, `$lookup`, `$count`, `$facet`, `$addFields`, `$set`, `$unset`, `$replaceRoot`, `$replaceWith`
- blocked stages: `$out`, `$merge`, `$geoNear`
- tenant scoping is injected automatically as the leading `$match` stage when the caller does not already express the same predicate
- planner-side guardrails cap stage count, payload size, sort keys, facet branches, lookup usage, and maximum result window
- workspace plan policy can further lower aggregation ceilings or disable aggregation entirely

This feature intentionally enables document analytics without exposing unrestricted provider passthrough execution.

## Import / export

JSON import and export routes are optimized for backup, restore, and controlled tenant data migration workflows:

- imports validate every document against collection rules before adapter execution
- replace and upsert imports require stable `_id` values to guarantee deterministic restore behavior
- exports return a stable manifest-friendly envelope with collection, tenant-scope, and consistency metadata
- imports and exports stay bounded by document-count and payload-size ceilings

## Transactions

Database-scoped transaction requests accept a bounded set of document operations across multiple collections in one logical MongoDB database:

- supported actions: `insert`, `update`, `replace`, `delete`
- transaction support is topology-aware and requires a deployment profile that exposes MongoDB transactions
- request validation preserves tenant scoping, collection validation, unique-index conflict checks, and commit-time guardrails before adapter dispatch
- workspace plan policy can reduce operation count, payload size, commit time, and concern levels, or disable transactions entirely

## Change streams

Change-stream registration is exposed as a topology-aware, bridge-aware control-plane contract:

- collection-scoped change streams inject tenant-aware match filters against `fullDocument`, `fullDocumentBeforeChange`, and update deltas
- only safe projection / enrichment stages are accepted on this surface
- transport is normalized through the realtime/event gateway bridge when available
- responses include compatibility metadata so clients can distinguish topology gaps from bridge unavailability

Because the public realtime delivery stack evolves independently, change-stream registration advertises readiness and topic metadata rather than bypassing the gateway directly.

## Tenant segregation

Every document operation stays tenant-scoped:

1. the request filter is narrowed with the effective tenant predicate
2. user-provided filters cannot widen access to another tenant
3. write payloads cannot change the tenant ownership field
4. bulk, aggregation, import/export, transaction, and change-stream operations inherit the same tenant predicate semantics
5. audit and error metadata preserve the effective tenant and workspace context for every documented operation

This feature intentionally models logical segregation inside shared MongoDB databases and collections.

## Collection validation, conflicts, and normalized errors

- If a collection declares `$jsonSchema` validation rules, the planner validates inserts, replacements, update candidates, and imported documents before dispatch.
- Request-time unique-index conflicts inside a bulk payload, import batch, or transactional mutation set are rejected deterministically before adapter execution.
- Provider duplicate-key, validation, permission, document-not-found, topology, and change-stream capability failures are normalized into stable API error classes.
- Safe corrective metadata is exposed only when it can be shared without leaking sensitive provider payloads or document contents.

Representative normalized error codes:

- `mongo_data_conflict_unique_index`
- `mongo_data_validation_failed`
- `mongo_data_permission_denied`
- `mongo_data_document_not_found`
- `mongo_data_plan_policy_violation`
- `mongo_data_capability_unavailable`

Safe error metadata can include:

- category and reason
- corrective action and corrective action list
- provider code/codeName when safe
- database, collection, document, and operation context
- audit context such as actor, tenant, workspace, origin, request, and correlation ids

## Audit and trace capture

MongoDB Data API responses and credential records are designed to preserve enough audit context for downstream logging and forensic correlation without exposing secrets.

Trace context can include:

- `requestId`
- `correlationId`
- `originSurface`
- `actorId`
- `actorType`
- `tenantId`
- `workspaceId`
- `requestedAt`
- `idempotencyKey`
- `effectiveRoleName`
- `contractVersion`

Result envelopes also publish:

- `auditRecordId`
- `auditSummary`

This keeps actor, tenant, workspace, and origin correlation aligned across document reads, mutations, advanced operations, and credential lifecycle events.

## Capability detection

Topology-dependent capabilities are surfaced through Mongo inventory compatibility metadata and per-operation compatibility summaries:

- aggregations, import, and export are available across supported MongoDB deployment profiles
- transactions require a compatible replica-set or sharded topology and an enabled transaction profile
- change streams require both a compatible topology and an available realtime/event gateway bridge

## Usage examples

### Backend service with scoped credential

```bash
curl -X POST \
  "https://api.example.test/v1/mongo/workspaces/wrk_01/data/tenant_alpha_main/credentials" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: mongo-cred-001" \
  -d '{
    "displayName": "orders-reader",
    "credentialType": "api_key",
    "ttlSeconds": 3600,
    "scopes": [
      {
        "databaseName": "tenant_alpha_main",
        "collectionName": "customer_orders",
        "allowedOperations": ["list", "get", "aggregate"]
      }
    ]
  }'
```

### Backend aggregation request under plan policy

```bash
curl -X POST \
  "https://api.example.test/v1/mongo/workspaces/wrk_01/data/tenant_alpha_main/collections/customer_orders/aggregations" \
  -H "Authorization: Bearer $SCOPED_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "pipeline": [
      { "$match": { "status": "open" } },
      { "$group": { "_id": "$status", "total": { "$sum": 1 } } },
      { "$limit": 20 }
    ]
  }'
```

The server applies tenant scope, plan ceilings, trace capture, and audit metadata even though the client does not choose those governance fields directly.

### Administrative error handling

```json
{
  "status": 409,
  "code": "GW_MONGO_DATA_CONFLICT",
  "message": "MongoDB unique index conflict.",
  "detail": {
    "reason": "unique_index_conflict",
    "category": "conflict",
    "correctiveAction": "Use a unique field value or update the existing document instead of inserting a duplicate.",
    "provider": {
      "code": 11000,
      "codeName": "DuplicateKey"
    },
    "resource": {
      "databaseName": "tenant_alpha_main",
      "collectionName": "customer_orders",
      "documentId": "ord_001"
    }
  }
}
```

## Notes

- The API is document-oriented and does not expose unrestricted provider passthrough operators.
- Sorting appends `_id` automatically when needed so cursor pagination remains stable.
- Bulk and advanced-operation limits are configurable but always bounded by safe operation-count and payload-size ceilings.
- The bridge-facing change-stream contract is additive and intentionally compatible with future realtime delivery work.
