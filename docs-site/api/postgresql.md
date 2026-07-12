# API Reference: PostgreSQL Data API

The current PostgreSQL data API is workspace-addressed. It is served by the control-plane executor
and backed by PostgreSQL with tenant/workspace scoping.

Base route:

```text
/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}
```

Examples use:

```bash
export API=https://api.example.com
export WORKSPACE_ID=<workspace-id>
export TOKEN=<bearer-token-or-service-account-token>
```

Use `Authorization: Bearer <token>` or a workspace API key where your deployment has issued one.

## Row endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/rows` | List, filter, project, order, and page rows. |
| `POST` | `/rows` | Insert one row. |
| `GET` | `/rows/by-primary-key?...` | Get one row by primary-key query parameters. |
| `PATCH` | `/rows/by-primary-key?...` | Update one row by primary-key query parameters. |
| `DELETE` | `/rows/by-primary-key?...` | Delete one row by primary-key query parameters. |
| `POST` | `/bulk/insert` | Insert multiple rows. |
| `POST` | `/bulk/update` | Update multiple rows. |
| `POST` | `/bulk/delete` | Delete multiple rows. |
| `POST` | `/search` | Vector search over a configured vector column. |

Full rows URL example:

```bash
export ROWS="$API/v1/postgres/workspaces/$WORKSPACE_ID/data/app/schemas/public/tables/orders/rows"
```

## Insert

```bash
curl -sS -X POST "$ROWS" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"customer":"acme","total":42.5,"status":"open"}'
```

Expected response shape:

```json
{
  "item": { "...": "inserted row" },
  "affected": 1,
  "access": { "...": "effective access metadata" }
}
```

## List, filter, project, and order

Filters are query parameters. A bare `column=value` is equality; `column=operator.value` supports
the operator set used by the runtime:

| Operator | Example |
| --- | --- |
| `eq`, `neq` | `status=eq.open` |
| `gt`, `gte`, `lt`, `lte` | `total=gte.100` |
| `in` | `id=in.(1,2,3)` |
| `like`, `ilike` | `customer=ilike.%ac%` |
| `json_path_eq` | `metadata=json_path_eq.<path-and-value>` |

Projection and ordering:

```bash
curl -sS "$ROWS?select=id,customer,total&status=eq.open&order=total.desc" \
  -H "authorization: Bearer $TOKEN"
```

Expected response shape:

```json
{
  "items": [],
  "page": {
    "size": 0,
    "returned": 0
  },
  "access": { "...": "effective access metadata" }
}
```

## Keyset pagination

```bash
curl -sS "$ROWS?page[size]=20&order=id.asc" \
  -H "authorization: Bearer $TOKEN" \
  | tee /tmp/orders-page-1.json

export AFTER="$(jq -r '.page.after // empty' /tmp/orders-page-1.json)"

curl -sS "$ROWS?page[size]=20&page[after]=$AFTER&order=id.asc" \
  -H "authorization: Bearer $TOKEN"
```

The cursor is opaque. Pass it back verbatim as `page[after]`.

## Primary-key operations

Primary-key values are query parameters on `/rows/by-primary-key`.

```bash
curl -sS "$ROWS/by-primary-key?id=ord_1001" \
  -H "authorization: Bearer $TOKEN"

curl -sS -X PATCH "$ROWS/by-primary-key?id=ord_1001" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"status":"closed"}'

curl -sS -X DELETE "$ROWS/by-primary-key?id=ord_1001" \
  -H "authorization: Bearer $TOKEN"
```

Composite keys use multiple query parameters.

## DDL and inventory

The executor also exposes structural PostgreSQL routes. These are management routes, not the old
`/v1/schemas` API.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/v1/postgres/databases` | List or create databases. |
| `GET` / `POST` | `/v1/postgres/databases/{databaseName}/schemas` | List or create schemas. |
| `GET` / `POST` | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables` | List or create tables. |
| `GET` / `POST` | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/columns` | List or create columns. |
| `GET` / `POST` | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/indexes` | List or create indexes. |
| `GET` | `/v1/postgres/workspaces/{workspaceId}/inventory` | Workspace PostgreSQL inventory. |

## Realtime

PostgreSQL table changes stream from:

```text
/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/changes
```

See [Realtime Subscriptions](/api/realtime).
