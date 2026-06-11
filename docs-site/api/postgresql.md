# API Reference — PostgreSQL Data API

REST CRUD and querying over SQL-backed collections, with PostgREST-style filtering, projection, ordering and **keyset pagination**. Every request is scoped to the caller's tenant by Row-Level Security (see [Security](/architecture/security)).

Authenticate with an `apikey` header. Examples use `$API` (gateway host) and `$KEY`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/collections/{name}/documents` | List / filter rows |
| POST | `/v1/collections/{name}/documents` | Create a row (document as JSON body) |
| PUT | `/v1/collections/{name}/documents/{id}` | Update a row |
| DELETE | `/v1/collections/{name}/documents/{id}` | Delete a row |
| POST | `/v1/collections/{name}/query` | Structured query |

## Create

```bash
curl -sX POST $API/v1/collections/orders/documents \
  -H "apikey: $KEY" -H 'content-type: application/json' \
  -d '{"customer":"acme","total":42.5,"status":"open"}'
```

## Filtering

Query params are PostgREST-style `column=operator.value`; a bare `column=value` defaults to `eq`:

| Operator | Example |
| --- | --- |
| `eq`, `neq` | `?status=eq.open` |
| `gt`, `gte`, `lt`, `lte` | `?total=gte.100` |
| `in` | `?id=in.(1,2,3)` |
| `like`, `ilike` | `?name=ilike.%ac%` |
| `json_path_eq` | `?meta=json_path_eq.…` |

Scalars are coerced: `?age=gte.18` compares as a number, `?active=eq.true` as a boolean.

## Projection & ordering

```bash
curl -s "$API/v1/collections/orders/documents?select=id,total&order=total.desc" -H "apikey: $KEY"
```

- `select=col1,col2` — restrict returned columns.
- `order=col.asc|desc` — sort.

## Keyset (cursor) pagination

```bash
# first page
curl -s "$API/v1/collections/orders/documents?page[size]=20" -H "apikey: $KEY"
# next page — pass the opaque cursor returned by the previous page
curl -s "$API/v1/collections/orders/documents?page[size]=20&page[after]=<cursor>" -H "apikey: $KEY"
```

Keyset pagination (not OFFSET) keeps paging stable and fast on large tables. The cursor is opaque (`serializePostgresDataApiCursor`); pass it back verbatim in `page[after]`.

## Structured query

For more complex reads use the query endpoint:

```bash
curl -sX POST $API/v1/collections/orders/query \
  -H "apikey: $KEY" -H 'content-type: application/json' \
  -d '{"filter":{"status":"open"},"order":[["total","desc"]],"limit":50}'
```

## Schema (DDL)

Defining collections/tables, columns and indexes is a `structural_admin` operation — create them from the console or via `POST /v1/schemas` (see [Control Plane](/api/control-plane)). The executor backs DDL with `postgres-ddl-executor.mjs` (schema/table/column/index).

## Isolation

Reads and writes run under a **non-`BYPASSRLS` role** with the tenant set per request, so RLS filters every statement — you only ever see your tenant's rows, even via a misformed query.
