# API Reference: MongoDB / FerretDB Data API

Falcone's document API is backed by FerretDB v2 over DocumentDB-on-PostgreSQL. The HTTP data API is
workspace-addressed and served by the control-plane executor.

Base route:

```text
/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}
```

Examples use:

```bash
export API=https://api.example.com
export WORKSPACE_ID=<workspace-id>
export TOKEN=<bearer-token-or-service-account-token>
export DOCS="$API/v1/mongo/workspaces/$WORKSPACE_ID/data/app/collections/profiles/documents"
```

Use `Authorization: Bearer <token>` or a workspace API key where your deployment has issued one.

## Document endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/documents` | List documents with optional JSON filter, sort, and cursor page. |
| `POST` | `/documents` | Insert one document. |
| `GET` | `/documents/{documentId}` | Read one document. |
| `PATCH` | `/documents/{documentId}` | Update one document. |
| `PUT` | `/documents/{documentId}` | Replace one document. |
| `DELETE` | `/documents/{documentId}` | Delete one document. |
| `POST` | `/bulk/write` | Bulk write. |
| `POST` | `/aggregations` | Aggregation request. |
| `POST` | `/imports` | Import documents. |
| `POST` | `/exports` | Export documents. |

## Insert

The runtime accepts either a raw document body or `{ "document": ... }`.

```bash
curl -sS -X POST "$DOCS" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"handle":"neo","tags":["red","blue"],"active":true}'
```

## List and filter

`filter` and `sort` query parameters are JSON values:

```bash
curl -sS "$DOCS?filter={\"tags\":\"red\"}&sort={\"handle\":1}&page[size]=50" \
  -H "authorization: Bearer $TOKEN"
```

When shell quoting becomes awkward, build the URL with `jq` or your HTTP client rather than typing
raw JSON into the query string.

Expected response shape:

```json
{
  "items": [],
  "page": {
    "size": 50
  }
}
```

## Update, replace, and delete

```bash
curl -sS -X PATCH "$DOCS/<document-id>" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"active":false}'

curl -sS -X PUT "$DOCS/<document-id>" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"handle":"neo","tags":["blue"],"active":false}'

curl -sS -X DELETE "$DOCS/<document-id>" \
  -H "authorization: Bearer $TOKEN"
```

## Document export and import

The console's workspace-scoped bulk import requires `format: "json"` and an explicit `mode`:

```json
{
  "format": "json",
  "mode": "upsert",
  "ordered": true,
  "documents": [{ "_id": "u1", "name": "alpha" }]
}
```

| Mode | Identity and write behavior |
| --- | --- |
| `insert` | Preserves a supplied `_id`; Mongo generates one if omitted. |
| `replace` | Requires `_id` on every document; replaces only a document in the verified tenant/workspace. Missing matches are skipped as `NOT_MATCHED`, with nothing inserted. |
| `upsert` | Requires `_id` on every document; replaces an in-scope match or inserts with that identity. Replaying an import creates no duplicates. |

Export strips the tenant/workspace fields and preserves `_id`. ObjectId identities use Extended
JSON, for example `{ "_id": { "$oid": "507f1f77bcf86cd799439011" } }`; import decodes that exact
form back to ObjectId. String and numeric identities stay unchanged. Export then upsert-import
into the same scope preserves document identity and BSON type. Other BSON types have no fidelity
guarantee in this transfer format.

Missing/invalid format or mode, a missing stable `_id` in replace/upsert, malformed `$oid`, or any
other `$`-prefixed operator key in `_id` returns `400 VALIDATION_ERROR` before writing anything.
All modes overwrite body-supplied scope fields with the verified tenant and workspace, and
replacement filters include both scope fields plus `_id`. Cross-tenant workspaces return
`404 WORKSPACE_NOT_FOUND` before any Mongo call.

Duplicate identities yield a generic conflict with no foreign document or driver details.
With `ordered: false`, conflicts are skipped as `DUPLICATE_ID` and later entries continue.
With `ordered: true` (default), the first conflict stops the import with `409 DUPLICATE_ID`;
previous successful writes remain. Replace never matches a foreign identity.

Successful console imports retain HTTP `200` and `entityType`, `importedCount`, `skippedCount`,
and `skipped`. The response also includes `format`, `mode`, `ordered`, `matchedCount`,
`upsertedCount`, and `replacedCount`; skipped entries carry a zero-based `index` and a `reason`.
`importedCount` includes successful inserts, upserts, and matched replacements.
`replacedCount` counts all matched replacements, even when the payload is unchanged.
`MONGO_IO_MAX_DOCS` bounds export and import (default 5000 documents).

## Collection management

Structural document-store routes are separate from data routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/v1/mongo/databases` | List or create databases. |
| `GET` / `DELETE` | `/v1/mongo/databases/{databaseName}` | Read or delete one database. |
| `GET` / `POST` | `/v1/mongo/databases/{databaseName}/collections` | List or create collections. |
| `GET` / `PUT` / `DELETE` | `/v1/mongo/databases/{databaseName}/collections/{collectionName}` | Read, update, or delete a collection. |
| `GET` / `POST` | `/v1/mongo/databases/{databaseName}/collections/{collectionName}/indexes` | List or create indexes. |
| `GET` | `/v1/mongo/workspaces/{workspaceId}/inventory` | Workspace document-store inventory. |

## Realtime

Document changes stream from:

```text
/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/changes
```

FerretDB v2 does not provide MongoDB change streams for this path. The repo's realtime implementation
uses PostgreSQL logical replication on the DocumentDB engine and tenant/workspace filtering in the
server-side pipeline.

See [Realtime Subscriptions](/api/realtime) and the
[FerretDB Document-Store Runbook](/architecture/ferretdb).
