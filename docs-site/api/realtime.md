# API Reference: Realtime Subscriptions

Realtime subscriptions are Server-Sent Events (SSE) served by the control-plane executor.

Current runtime routes are workspace-addressed:

| Backend | SSE route |
| --- | --- |
| Mongo/FerretDB documents | `/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/changes` |
| PostgreSQL rows | `/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/changes` |

The older `/v1/events/subscribe` route is not used in the current developer docs.

## Subscribe to document changes

```bash
export API=https://api.example.com
export WORKSPACE_ID=<workspace-id>
export TOKEN=<bearer-token-or-service-account-token>

curl -sN \
  "$API/v1/realtime/workspaces/$WORKSPACE_ID/data/app/collections/profiles/changes" \
  -H "authorization: Bearer $TOKEN"
```

Browser `EventSource` cannot set headers. SSE routes accept `?apikey=` for low-privilege workspace
API keys when your deployment has issued one:

```js
const url = new URL(`${API}/v1/realtime/workspaces/${workspaceId}/data/app/collections/profiles/changes`)
url.searchParams.set('apikey', anonKey)
const events = new EventSource(url)
events.onmessage = (event) => console.log(JSON.parse(event.data))
```

Header credentials win if both a header and query key are present.

## Subscribe to PostgreSQL row changes

```bash
curl -sN \
  "$API/v1/realtime/workspaces/$WORKSPACE_ID/data/app/schemas/public/tables/orders/changes" \
  -H "authorization: Bearer $TOKEN"
```

## Event shape

Realtime frames are JSON SSE messages. The exact payload fields depend on the backend executor and
operation, but the stream represents insert, update/replace, and delete events for the requested
tenant/workspace resource.

## Sources

| Backend | Mechanism |
| --- | --- |
| Mongo/FerretDB documents | PostgreSQL logical replication on the DocumentDB engine, because FerretDB v2 does not provide MongoDB change streams for this path. |
| PostgreSQL rows | PostgreSQL trigger and `LISTEN`/`NOTIFY` pipeline scoped to the tenant/workspace table stream. |

Document-store deletes require prior-row information to keep delete events tenant-scoped. See the
[FerretDB Document-Store Runbook](/architecture/ferretdb) for the logical-replication details.

## Application event streams

The generated OpenAPI also includes event-topic routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/events/topics` | Create an event topic. |
| `GET` | `/v1/events/topics/{resourceId}` | Read one topic. |
| `POST` | `/v1/events/topics/{resourceId}/publish` | Publish to a topic. |
| `GET` | `/v1/events/topics/{resourceId}/stream` | Stream one topic. |

The runtime executor also exposes workspace-addressed event routes:

```text
/v1/events/workspaces/{workspaceId}/topics
/v1/events/workspaces/{workspaceId}/topics/{topic}/publish
/v1/events/workspaces/{workspaceId}/topics/{topic}/messages
```

Use the route family exposed by your gateway/catalog for the deployment you are testing.
