# API Reference — Realtime Subscriptions

Realtime delivers live data changes over **Server-Sent Events (SSE)**. It is tenant-scoped **at the source** — matching happens inside the change-stream pipeline / notify channel — so a subscriber can only ever receive its own tenant's changes.

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

- `insert` / `update` / `replace` carry the full current document (`fullDocument`).
- `delete` carries the **prior** document (`fullDocumentBeforeChange`), which is also how the delete is kept tenant-scoped.

## Sources

| Backend | Mechanism | Notes |
| --- | --- | --- |
| MongoDB | `collection.watch()` change stream with a tenant `$match` | Requires a **replica set**; deletes need collection **pre-images** (`changeStreamPreAndPostImages`, MongoDB 6.0+, enabled best-effort on subscribe) |
| PostgreSQL | trigger → `NOTIFY` on a per-tenant channel + `LISTEN` | Channel `flc_rt_<md5(schema.table:tenant_id)>`; deletes via `OLD.tenant_id`; payloads above ~8000 bytes are guarded |

## Events (publish/subscribe)

The same prefix also serves a tenant-scoped event bus for application events:

```bash
curl -sX POST $API/v1/events/publish -H "apikey: $KEY" \
  -H 'content-type: application/json' \
  -d '{"topic":"order.created","data":{"id":123}}'
```

## Isolation guarantees

- Tenant matching is **server-side, inside the pipeline/channel** — not a client filter.
- Mongo deletes are scoped via the pre-image's `tenantId`; if pre-images can't be enabled, deletes are simply **not delivered** (never leaked).
- Postgres subscribers `LISTEN` only on their own tenant's channel.
