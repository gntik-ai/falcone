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
