# API Reference — MongoDB Data API

REST CRUD and querying over document collections, with **cursor pagination**. Tenant isolation is enforced by an adapter-injected `tenantId` predicate on every read and stamped on every write (see [Security](/architecture/security)).

Authenticate with an `apikey` header.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/collections/{name}/documents` | List / filter documents |
| POST | `/v1/collections/{name}/documents` | Insert a document (document as JSON body) |
| PUT | `/v1/collections/{name}/documents/{id}` | Replace/update a document |
| DELETE | `/v1/collections/{name}/documents/{id}` | Delete a document |
| POST | `/v1/collections/{name}/query` | Structured find/aggregate |

## Insert

The request body **is** the document:

```bash
curl -sX POST $API/v1/collections/profiles/documents \
  -H "apikey: $KEY" -H 'content-type: application/json' \
  -d '{"handle":"neo","tags":["red","blue"],"active":true}'
```

## Read & query

Simple reads use the documents endpoint; richer queries use the query endpoint with a Mongo-style filter:

```bash
curl -sX POST $API/v1/collections/profiles/query \
  -H "apikey: $KEY" -H 'content-type: application/json' \
  -d '{"filter":{"tags":"red"},"sort":{"handle":1},"limit":50}'
```

## Cursor pagination

List responses are paginated with an opaque cursor (`encodeMongoDataCursor`). Pass the cursor from the previous page to fetch the next; cursor paging is stable across inserts.

## Update & delete

```bash
curl -sX PUT    $API/v1/collections/profiles/documents/<id> -H "apikey: $KEY" \
  -H 'content-type: application/json' -d '{"active":false}'
curl -sX DELETE $API/v1/collections/profiles/documents/<id> -H "apikey: $KEY"
```

## Realtime

Document changes can be streamed live — see [Realtime Subscriptions](/api/realtime). Mongo realtime requires the database to run as a **replica set** (change streams), and tenant-scoped deletes require collection **pre-images**.

## Isolation

The adapter never issues an unscoped query: the `tenantId` filter is injected into reads and stamped onto writes, and the realtime pipeline `$match`es the verified tenant. There is no client-controllable path to another tenant's documents.
