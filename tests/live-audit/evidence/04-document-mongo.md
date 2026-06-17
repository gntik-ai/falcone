# Live-stack audit — Capability #4: Document / Mongo API

Target: running `falcone` ns (kind test-cluster-b), Helm `in-falcone-0.3.0`.
Executor: `falcone-cp-executor` image `in-falcone-control-plane-executor:0.9.5`, env
`MONGO_HOST=falcone-mongodb:27017` `MONGO_USER=root` `MONGO_AUTH_SOURCE=admin` (legacy mongo).
Tested EMPIRICALLY via the executor data-plane (port-forward 18082), API key + trust-header,
plus the raw `mongodb` driver against legacy mongo (27018) and FerretDB (17017).
Spec: `tests/live-audit/specs/04-document-mongo.sh` (22/22 PASS). Resource prefix `lamongo*`, all cleaned up.

## Status per functionality

| Functionality | Route | Status |
|---|---|---|
| Insert document | `POST .../documents` | **Active** (201; injects `tenantId`) |
| List documents | `GET .../documents` | **Active** (200; filtered by `tenantId`; `?filter=` JSON works; `page[size]`/cursor) |
| Get document by id | `GET .../documents/{id}` | **Broken** — always `{"found":false,"item":null}` |
| Update (partial) by id | `PATCH .../documents/{id}` | **Broken** — `matched:0` (also requires `$`-operators) |
| Replace by id | `PUT .../documents/{id}` | **Broken** — `matched:0,modified:0` |
| Delete by id | `DELETE .../documents/{id}` | **Broken** — `deleted:0` |
| Aggregation | `POST .../aggregations` | **Not deployed** (404 `NO_ROUTE`) |
| Bulk write | `POST .../bulk/write` | **Not deployed** (404 `NO_ROUTE`) |
| Transactions | `POST .../data/{db}/transactions` | **Not deployed** (404 `NO_ROUTE`) |
| Change-streams (data route) | `POST .../change-streams` | **Not deployed** (404 `NO_ROUTE`) |
| Export / Import | `POST .../exports` `/imports` | **Not deployed** (404 `NO_ROUTE`) |
| Admin surface (`/v1/mongo/databases…`, collections, indexes, users, views, templates) | proxied to control-plane | **Not testable here** — requires Bearer JWT (`401 UNAUTHENTICATED` via executor data-plane path); GET-only locally per `routes.mjs`; many are catalog-only |
| FerretDB wired into Data API | — | **Not deployed / in-flight** (FerretDB reachable but API uses legacy mongo) |

Auth: BOTH the API-key path (`Authorization: ApiKey flc_…`, minted via `mint_key`) and the
trust-header path (`x-tenant-id`/`x-workspace-id`) accept inserts/lists. `tenantId` is injected
from the resolved tenant regardless of auth path.

## Where documents physically land (raw driver, legacy mongo 27018)

The `{db}` path segment maps **verbatim** to a physical Mongo database name, and the
`{collection}` segment to a physical collection. Both `data/appdb/...` and the tenant's real
`data/$TA_DB/...` (`wsdb_ops_demo_0610_ops_ws`) worked and created the corresponding physical db:

```
ALL DBs: admin, appdb, config, local, rtdemo, wsdb_ops_demo_0610_ops_ws, wsdemo, capdb
appdb.<coll> _id type=ObjectId  _id=6a31ad72…  tenantId=ffd33d99-…-c1cc  keys=_id,name,n,tenantId
```

There is **no scoping of `{db}` to the tenant/workspace**: the path is fully caller-controlled.
Documents are stored in a **shared** physical db/collection keyed only by an injected `tenantId`
field. Two tenants writing the same `data/appdb/collections/X` path co-mingle in ONE physical
collection (proven below). `_id` is a real BSON `ObjectId`.

## Cross-tenant isolation probe (critical) — RESULT: API-layer isolation HOLDS; physical co-mingling

A inserts into `appdb/<coll>`, then B reads/writes the SAME path:

```
A POST appdb/<coll>  -> 201 {"item":{...,"tenantId":"…c1cc"}}        (A's secret doc)
B GET  appdb/<coll>  (B key + B ws)            -> 200 {"items":[]}    ← B sees 0 of A's docs
B GET  appdb/<coll>  (B key, A's ws spoofed)   -> 200 {"items":[]}    ← still 0
B POST appdb/<coll>  -> 201 (B's doc)                                 (lands in SAME collection)
A GET  appdb/<coll>  -> 200 items=[A's doc only]                      ← A does NOT see B's doc
```

Raw driver confirms both docs co-exist in ONE physical collection:

```
PHYSICAL appdb.<coll> holds 2 docs:
   owner=tenantA tenantId=ffd33d99-…-c1cc
   owner=tenantB tenantId=a5db1fad-…-2097
```

**Verdict:** No cross-tenant document LEAK through the data API on insert/list — the executor
injects and filters by `tenantId` on every list, so B cannot read A's documents even when
targeting A's workspaceId/db/collection. **However**, isolation is *soft / field-based*: all
tenants share one physical Mongo database+collection (e.g. `appdb`), partitioned only by a
`tenantId` field. This is a single-mistake-from-leak posture (one un-scoped query path = full
cross-tenant exposure), and a caller can freely target/poison another tenant's logical
db/collection namespace and write into the same physical collection (integrity/quota concern, and
co-tenancy of data at rest). Compare: PostgreSQL data plane has the same "shared `in_falcone`"
property (known fact); the document store mirrors it.

> The by-id routes (GET/PATCH/PUT/DELETE) cannot be used for IDOR because they are uniformly
> broken (never match any doc) — but that is a functional bug, not a security control.

## BUG: by-id document operations never match (P1, functional)

GET/PATCH/PUT/DELETE by the id the API itself just returned all silently no-op for the OWNER:

```
POST … /documents            -> 201 insertedId=6a31adfe668e23a903644cca
GET  … /documents/6a31adfe…  -> 200 {"found":false,"item":null}     (doc clearly exists in list)
PATCH… /documents/6a31adfe…  -> 200 {"matched":0,"modified":0,…}    (with $set operator)
PUT  … /documents/6a31adfe…  -> 200 {"matched":0,"modified":0,…}
DELETE…/documents/6a31adfe…  -> 200 {"deleted":0}
```

Root cause proven with the raw driver: `_id` is stored as `ObjectId`, but the by-id handler
queries with the **string** form:

```
stored _id: ObjectId('6a31adfe668e23a903644cca')
query {_id: STRING}    matches: NO  ← the bug
query {_id: ObjectId}  matches: YES
```

The handler passes `params.documentId` as a raw string to the `{_id}` filter without
`new ObjectId(id)` coercion (and likely the same on the `tenantId`-scoped update/delete filters).
**Severity: P1** — half of the documented CRUD surface (read-one, update, replace, delete by id)
is unusable; clients cannot operate on a document by the id the API returned, and DELETE returning
`200 {"deleted":0}` is silently lossy (no 404). PATCH additionally rejects plain objects with
`mongo_data_invalid_update` ("Partial updates must use MongoDB update operators") — by design, but
even with `$set` it still no-ops due to the same id mismatch.

Repro (one line): `K=$(mint_key "$TA_TENANT" "$TA_WS" service); ID=$(exk POST "/v1/mongo/workspaces/$TA_WS/data/appdb/collections/lamongoX/documents" "$K" '{"a":1}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["insertedId"])'); exk GET "/v1/mongo/workspaces/$TA_WS/data/appdb/collections/lamongoX/documents/$ID" "$K"` → `{"found":false,"item":null}`.

## FerretDB wiring check (item 4) — confirmed: API uses LEGACY mongo, NOT FerretDB

- Executor env: `MONGO_HOST=falcone-mongodb:27017` (legacy). API-created `lamongo*` collections
  appear ONLY in legacy mongo `appdb`, never in FerretDB.
- FerretDB **is reachable** at `127.0.0.1:17017` (user `falcone_doc_admin`, authSource `admin`),
  with its own databases incl. **per-tenant** ones: `falcone_doc_ten_live_a`, `falcone_doc_ten_live_b`
  (each with a `probe` collection) and a separate `appdb` (collection `items`) — the *intended*
  DB-per-tenant FerretDB isolation model, but the live data API does not route there.
- **Classification:** FerretDB-wired-into-API = **NOT DEPLOYED / in-flight**. The repo source
  `deploy/kind/control-plane/mongo-handlers.mjs` *defaults* to FerretDB, but the deployed 0.9.5
  image is env-overridden to legacy mongo and its data-plane handler injects/filters `tenantId`
  (the source's read-only console handler does not), so the running image differs from this source.

## Not testable / out of scope here

- The full admin surface (`/v1/mongo/databases`, collections/indexes/users/views/templates CRUD)
  requires a Bearer JWT and is proxied to the control-plane; via the executor data-plane it returns
  `401 UNAUTHENTICATED`. Many of those 53 catalog routes are intended-surface only.
- Advanced data routes (aggregation/bulk/transaction/change-stream/export/import) are wired in the
  392-route catalog but return `404 NO_ROUTE` on the live executor → not deployed.
