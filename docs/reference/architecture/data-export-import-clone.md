# Data export, import, and clone

Falcone exposes a data **export / import / clone** surface across its data families so a tenant can
move its own data between resources, snapshot a tenant's configuration, and reproduce a workspace.
Every operation is **tenant-scoped**: an isolation chokepoint runs **before** any
storage/document/database/registry backend call, and the tenant/workspace scope is always taken from
the **verified caller identity**, never from the request body. A caller that is neither
superadmin/internal nor the owner of the target resource is denied with no existence leak (storage:
`404 BUCKET_NOT_FOUND`; mongo/postgres/functions/tenant/workspace: `404`/`403` matching the family's
existing behaviour), and the backend is never touched. Raw backend error payloads and physical
resource paths are never echoed to the caller.

All routes ride the gateway under `/v1/*` and require an authenticated principal.

## Scope and isolation model

- **Chokepoint first.** Ownership/own-tenant is checked before any backend call. The blackbox suite
  asserts (with a fetch/client spy) that a cross-tenant caller is rejected with the backend never
  touched.
- **Scope from identity, not the body.** Document and row imports stamp the workspace's canonical
  `tenantId`+`workspaceId` onto every imported record; a body-supplied `tenantId`/`workspaceId` is
  ignored. Function imports re-scope the bundle to the caller's tenant/workspace and reject a
  cross-scope bundle (`IMPORT_SCOPE_VIOLATION`). Storage imports reject a per-entry foreign source
  tenant (`CROSS_TENANT_VIOLATION`).
- **No body-driven cross-tenant clone.** A workspace clone always creates the target under the
  source's verified tenant; an explicit foreign `targetTenantId` is rejected.

## v1 bounded-size limitation

This is a **v1**: data movement is **bounded and synchronous** with **self-contained inline
artifacts** — export returns the data inline in the response body, and import accepts that same
artifact shape. There is no async pipeline, no streaming, and no presigned-URL lifecycle for the
movement itself. Per-object / per-row / per-document and total-size caps apply; exceeding a cap
returns `413`. The default caps are operator-overridable via environment variables
(`STORAGE_EXPORT_MAX_OBJECTS`, `STORAGE_EXPORT_MAX_OBJECT_BYTES`, `STORAGE_EXPORT_MAX_TOTAL_BYTES`,
`MONGO_IO_MAX_DOCS`, `PG_IO_MAX_ROWS`). Very large datasets that exceed the inline caps are future
work (a streaming/async pipeline).

## Storage bucket export / import

Move objects between buckets the caller owns. Export lists a bucket's objects, downloads each, and
returns a manifest with inline base64 object bodies; import accepts that manifest and PUTs the decoded
objects into a target bucket the caller owns.

```text
POST /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/exports
GET  /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/exports/{manifestId}
POST /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/imports
```

- The export response is a `storage_export_manifest` (`manifestId`, `sourceBucketId`,
  `sourceTenantId`, `totalObjects`, `totalBytes`, `entries[]`). Each entry carries the object body
  inline under `bodyReference` (`{ tenantId, encoding: "base64", inlineBase64 }`).
- The manifest is also **persisted** as a reserved `.falcone/exports/<manifestId>.json` object in the
  same bucket, so `GET .../exports/{manifestId}` reads it back. Reserved keys (`.falcone/…`,
  `_platform/…`) are hidden from the object listing, excluded from usage/quota accounting, and refused
  by import — so a manifest can never be overwritten or used to smuggle data, and it never appears as
  tenant object data.
- Import re-validates every entry against the **target** tenant: a path-traversal key
  (`INVALID_OBJECT_KEY`), a reserved/protected key (`OBJECT_PROTECTED`), or a per-entry foreign source
  tenant (`CROSS_TENANT_VIOLATION`) is skipped (reported per-entry, never written). `conflictPolicy`
  controls what happens when an entry's target object key already exists: `overwrite` (default) replaces
  it; `skip` leaves the existing object untouched and reports the entry `skipped` (`OBJECT_EXISTS`);
  `fail` refuses the entry and reports it `failed` (`OBJECT_EXISTS`). `skip` and `fail` never overwrite,
  and the conflict check is per-entry — non-conflicting entries in the same manifest still import.

```bash
# export, then import into another bucket the same tenant owns
curl -s -X POST -H "authorization: Bearer $TOKEN" \
  "$GATEWAY/v1/storage/workspaces/$WS/buckets/$SRC/exports" > manifest.json
curl -s -X POST -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  --data @<(jq '{manifest: .}' manifest.json) \
  "$GATEWAY/v1/storage/workspaces/$WS/buckets/$DST/imports"
```

## MongoDB document export / import

WORKSPACE-addressed; export reads documents stamped with **both** the workspace's `tenantId` and its
`workspaceId` (the scope the data-API write path stamps), and import stamps that same verified scope
onto every inserted document.

```text
POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/exports
POST /v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/imports
```

- Export strips the Mongo `_id` and the scope fields from each exported document.
- Import body is `{ "documents": [ … ] }`. Any `tenantId`/`workspaceId`/`_id` carried in a document
  is dropped and re-stamped with the caller's verified scope — so an import can never write into
  another tenant or workspace.

## PostgreSQL table data export / import

WORKSPACE-addressed; the database must be mapped to the caller's workspace. **SQL-injection-safe:**
schema/table/column identifiers are validated against `information_schema` for that database and
double-quote-escaped (never interpolated raw); every value is bound via a `$N` placeholder; unknown
columns on import are dropped.

```text
POST /v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/exports
POST /v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/imports
```

- Export returns `{ columns, rowCount, rows }`. Import body is `{ "rows": [ { column: value, … } ] }`;
  only keys that are real, validated columns of the exact target table are inserted.

## Function definition export / import

Export emits a self-contained bundle (resource references **and** deployable `definitions` carrying
source, runtime, entrypoint, parameters); import re-scopes the bundle to the caller's verified
tenant/workspace and upserts the function registry row(s).

```text
GET  /v1/functions/actions/{resourceId}/definition-export
GET  /v1/functions/workspaces/{workspaceId}/packages/{packageName}/definition-export
POST /v1/functions/workspaces/{workspaceId}/definition-imports
POST /v1/functions/workspaces/{workspaceId}/package-definition-imports
```

- The package name is the OpenWhisk-style prefix of the action name (`<packageName>/<actionName>`).
- A bundle whose resources reference another tenant/workspace is rejected `403`
  (`IMPORT_SCOPE_VIOLATION`) before any write.
- Import persists the **registry row**; it does NOT redeploy the Knative service from the imported
  source (`notDeployed: "knative-service"`). Redeploy is a separate `POST /v1/functions/actions` step.

## Audit record export

The tenant and workspace audit-export routes return a **real masked export** (previously a no-op
`202` ack): the tamper-evident audit store is queried for the resolved scope and the export masking
profile is applied to sensitive detail fields.

```text
POST /v1/metrics/tenants/{tenantId}/audit-exports
POST /v1/metrics/workspaces/{workspaceId}/audit-exports
```

- The own-tenant chokepoint is preserved — a cross-tenant audit export is denied `403`.

## Tenant configuration export

A READ-ONLY snapshot of a tenant's **non-sensitive** configuration: tenant metadata, its workspaces
(slug/environment), its first-class environments, and resolved quota limits. **Secrets, credentials,
BYOK keys, service-account material, and tokens are excluded** (stripped recursively).

```text
POST /v1/tenants/{tenantId}/exports
```

## Workspace clone

Reproduce a source workspace's resources into a **new** target workspace in the **same** tenant. The
function-definition registry is copied per the clone policy; secrets, credentials, and service
accounts are **never** copied (`resetCredentialReferences`). The target is always created under the
source's verified tenant, so a cross-tenant clone is impossible.

```text
POST /v1/workspaces/{workspaceId}/clone
```

- Request body: `{ "displayName"?, "slug"?, "environment"?, "clonePolicy"? }`. The new workspace's own
  backing database is provisioned fresh (no source data co-mingling).
- The new-workspace quota (`max_workspaces`) is enforced exactly as for a normal create.
