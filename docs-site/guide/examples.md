# Usage Examples

Short, copy-pasteable recipes against the public gateway. They assume `$API` is your gateway host and `$KEY` is an API key (`flc_anon_…` for read-mostly browser use, `flc_service_…` for privileged server-side use). The platform resolves the tenant **from the key**.

```bash
export API=https://api.example.test
export KEY=flc_service_XXXXXXXXXXXXXXXX
H="apikey: $KEY"
```

## Relational data (PostgreSQL)

CRUD and PostgREST-style querying over a SQL-backed collection:

```bash
# Create
curl -sX POST $API/v1/collections/orders/documents -H "$H" \
  -H 'content-type: application/json' \
  -d '{"customer":"acme","total":42.5,"status":"open"}'

# List with filter, projection, ordering
curl -s "$API/v1/collections/orders/documents?status=eq.open&select=id,total&order=total.desc" -H "$H"

# Keyset pagination — page size + cursor
curl -s "$API/v1/collections/orders/documents?page[size]=20" -H "$H"
curl -s "$API/v1/collections/orders/documents?page[size]=20&page[after]=<cursor-from-prev-page>" -H "$H"

# Update / delete by id
curl -sX PUT    $API/v1/collections/orders/documents/123 -H "$H" -d '{"status":"closed"}'
curl -sX DELETE $API/v1/collections/orders/documents/123 -H "$H"
```

Supported filter operators: `eq, neq, gt, gte, lt, lte, in, like, ilike, json_path_eq`. Examples: `?age=gte.18`, `?id=in.(1,2,3)`, `?name=ilike.%ac%`.

## Document data (MongoDB)

The same collection API serves document-shaped data; richer queries go through the query endpoint:

```bash
curl -sX POST $API/v1/collections/profiles/documents -H "$H" \
  -d '{"handle":"neo","tags":["red","blue"]}'

# Structured query (filter / sort / limit)
curl -sX POST $API/v1/collections/profiles/query -H "$H" \
  -H 'content-type: application/json' \
  -d '{"filter":{"tags":"red"},"sort":{"handle":1},"limit":50}'
```

## Object storage

S3-style buckets and objects:

```bash
# Upload
curl -sX PUT $API/v1/objects/avatars/neo.png -H "$H" \
  --data-binary @neo.png -H 'content-type: image/png'

# Download
curl -s  $API/v1/objects/avatars/neo.png -H "$H" -o neo.png

# Delete
curl -sX DELETE $API/v1/objects/avatars/neo.png -H "$H"
```

## Events

Publish to and subscribe from a tenant-scoped event stream:

```bash
# Publish
curl -sX POST $API/v1/events/publish -H "$H" \
  -H 'content-type: application/json' \
  -d '{"topic":"order.created","data":{"id":123}}'

# Subscribe (SSE). For browsers, pass the key as ?apikey= instead of a header.
curl -sN "$API/v1/events/subscribe?topic=order.created" -H "$H"
```

## Serverless functions

Invoke a deployed function:

```bash
curl -sX POST $API/v1/functions/resize-image/invoke -H "$H" \
  -H 'content-type: application/json' \
  -d '{"bucket":"avatars","key":"neo.png","width":128}'
```

Deploying/configuring functions is a `structural_admin` operation (`POST /v1/functions`, `PUT /v1/functions/{id}/config`) — do it from the console or with an admin token.

## Analytics

```bash
curl -s "$API/v1/analytics/query?metric=requests&window=24h" -H "$H"
```

## Anon vs service keys

| | `flc_anon_…` | `flc_service_…` |
| --- | --- | --- |
| Where it lives | shippable to the browser | server-side / CI only |
| Privilege | read-mostly, RLS-scoped | elevated within the tenant |
| Transport | `apikey` header, or `?apikey=` for SSE | `apikey` header only |

Both are **tenant-bound**: the platform never trusts a client-supplied `x-tenant-id`; the tenant comes from the verified key (or a verified JWT). A presented-but-invalid key fails closed with `401`.

See [Gateway & Routing](/api/gateway) for rate limiting and JWT issuance.
