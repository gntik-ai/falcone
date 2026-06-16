# API Reference — Realtime Subscriptions

Realtime delivers live data changes over **Server-Sent Events (SSE)**. It is tenant-scoped **at the source** — matching happens inside the logical-replication consumer / notify channel — so a subscriber can only ever receive its own tenant's changes.

## Subscribe (SSE)

```
GET /v1/events/subscribe
```

Because a browser `EventSource` cannot set headers, SSE routes accept the (low-privilege, read-only) anon key as a query parameter:

```js
const url = new URL('https://api.example.test/v1/events/subscribe')
url.searchParams.set('collection', 'todos')
url.searchParams.set('apikey', 'flc_anon_…')   // header still wins if both are present
const es = new EventSource(url)
es.onmessage = (e) => console.log(JSON.parse(e.data))
```

From a server (where you can set headers), use the `apikey` header instead:

```bash
curl -sN "$API/v1/events/subscribe?collection=todos" -H "apikey: $KEY"
```

A subscribe **without tenant identity returns `401`** (fails closed).

## Event shape

Each change is delivered as a JSON event:

```json
{ "type": "insert | update | replace | delete",
  "documentId": "…",
  "document": { "...": "the full document (or the prior document for a delete)" } }
```

- `insert` / `update` / `replace` carry the full current document. For the document store, a logical-replication `UPDATE` carries the full new image, so updates surface as `replace`.
- `delete` carries the **prior** document, which is also how the delete is kept tenant-scoped.

## Sources

| Backend | Mechanism | Notes |
| --- | --- | --- |
| FerretDB / DocumentDB (document store) | Postgres **`pgoutput`** logical-replication slot on the DocumentDB engine's `documentdb_data` tables, with consumer-side `tenantId` filtering | FerretDB v2 has **no MongoDB change streams**; **no replica set** is involved. Requires `wal_level=logical`; deletes use `REPLICA IDENTITY FULL` pre-images. See the [FerretDB Document-Store Runbook](/architecture/ferretdb#change-stream-remediation) |
| PostgreSQL | trigger → `NOTIFY` on a per-tenant channel + `LISTEN` | Channel `flc_rt_<md5(schema.table:tenant_id)>`; deletes via `OLD.tenant_id`; payloads above ~8000 bytes are guarded |

## Events (publish/subscribe)

The same prefix also serves a tenant-scoped event bus for application events:

```bash
curl -sX POST $API/v1/events/publish -H "apikey: $KEY" \
  -H 'content-type: application/json' \
  -d '{"topic":"order.created","data":{"id":123}}'
```

## Isolation guarantees

- Tenant matching is **server-side, inside the logical-replication consumer / channel** — not a client filter.
- Document-store deletes are scoped via the WAL pre-image's `tenantId` (`REPLICA IDENTITY FULL`); a row that does not match the verified tenant is simply **not delivered** (never leaked).
- Postgres subscribers `LISTEN` only on their own tenant's channel.
