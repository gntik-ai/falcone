# Live-stack audit — Capability #8: Realtime / CDC (SSE change streams)

Target: running `falcone` ns (kind test-cluster-b), Helm `in-falcone-0.3.0`.
Executor: `falcone-cp-executor` image `localhost:30500/in-falcone-control-plane-executor:0.9.5`
(entrypoint `apps/control-plane/src/runtime/main.mjs`; runtime predates the FerretDB/DocumentDB
realtime re-arch `5dffae3` — the deployed realtime executor is the **Mongo change-stream** version
from commit `66ea6f0`, confirmed empirically: streams open against legacy mongo, deletes use
change-stream pre-images).
Tested EMPIRICALLY via the executor data-plane (port-forward 18082), real `flc_service` API keys
minted per workspace (`?apikey=` SSE query auth). Spec: `tests/live-audit/specs/08-realtime.sh`
(11/11 PASS, run twice, idempotent). Resource prefix `lart*`, all cleaned up (mongo collections
dropped, pg test rows deleted).

Both SSE routes (server.mjs:353-359):
- Mongo collection: `GET /v1/realtime/workspaces/{ws}/data/{db}/collections/{coll}/changes`
- Postgres table:   `GET /v1/realtime/workspaces/{ws}/data/{db}/schemas/{s}/tables/{t}/changes`

## Status per functionality

| Functionality | Stream type | Status |
|---|---|---|
| Subscribe (open SSE) | mongo collection | **Active** (200 `text/event-stream`, `retry: 3000`) |
| Subscribe (open SSE) | pg table | **Active** (200; trigger+LISTEN/NOTIFY created on subscribe) |
| Push INSERT | mongo | **Active** — frame delivered with full document + `tenantId` |
| Push UPDATE/REPLACE | mongo | **Active** — frame delivered (`type:"update"`, full doc via `updateLookup`) |
| Push DELETE | mongo | **Broken** — delete event **never delivered** even with pre-images enabled (BUG RT-1) |
| Push INSERT | pg | **Active** — frame delivered with full row |
| Push UPDATE | pg | **Active** — frame delivered with full row |
| Push DELETE | pg | **Active** — frame delivered (carries prior row via `COALESCE(NEW,OLD)`) |
| SSE auth via `?apikey=` | both | **Active** — required; missing/garbage key → `401 UNAUTHENTICATED` (no stream) |
| SSE auth via `Authorization: ApiKey` header | both | **Active** — header path also opens the stream |
| Cross-tenant isolation | mongo | **HOLDS** — B subscribing A's path receives NONE of A's events |
| Cross-tenant isolation | pg | **HOLDS** — B subscribing A's path receives NONE of A's events |

## Deployment classification (501 discrimination)

Neither route returns `501 REALTIME_DISABLED`. The mongo realtime executor IS wired in the deployed
0.9.5 image (it predates the HEAD re-arch that gates the mongo executor behind
`REALTIME_DOCUMENTDB_URL` — that env is absent on the live pod, but the deployed `66ea6f0` version
wires the mongo change-stream executor off `MONGO_URI`, which is present). The pg realtime executor
is always created (`createPostgresRealtimeExecutor`, trigger + LISTEN/NOTIFY).

Backend facts (verified):
- Legacy mongo `falcone-mongodb-0` is a **single-node replica set** (`replSetGetStatus` → `set=rs0,
  members=1`), so MongoDB **change streams ARE available** (not a standalone — task item 4: change
  streams are NOT unavailable here).
- PG realtime targets the shared `in_falcone` DB (`resolveConnection` ignores workspaceId), per the
  known shared-DB fact. The capture trigger is created as role `falcone` (data DSN; no separate
  adminDsn supplied) — it succeeds only on tables `falcone` owns.

## Push-confirmation evidence (actual SSE frames captured)

### Mongo — insert + update delivered (subscribe → mutate → frame appears)
```
event: insert
data: {"type":"insert","documentId":"6a31afa9668e23a903644cce",
       "document":{"_id":"6a31afa9...","marker":"PUSH-26310","n":1,
                   "tenantId":"ffd33d99-0cf9-443e-ad5c-ba899420c1cc"}}
event: update
data: {"type":"update","documentId":"6a31afe9668e23a903644cd1",
       "document":{"_id":"6a31afe9...","marker":"SEED-12713","v":2,
                   "tenantId":"ffd33d99-...-c1cc","updated":true}}
```

### Postgres — insert + update + delete ALL delivered
```
event: insert
data: {"type":"insert","documentId":"lart28871",
       "document":{"id":"lart28871","body":"PG-PUSH-28871","tenant_id":"ffd33d99-...-c1cc"}}
event: update
data: {"type":"update","documentId":"lart28871",
       "document":{"id":"lart28871","body":"PG-UPD-28871","tenant_id":"ffd33d99-...-c1cc"}}
event: delete
data: {"type":"delete","documentId":"lart28871",
       "document":{"id":"lart28871","body":"PG-UPD-28871","tenant_id":"ffd33d99-...-c1cc"}}
```

## Cross-tenant isolation probe (CRITICAL) — RESULT: ISOLATION HOLDS on BOTH stream types

Setup: B subscribes to **A's** collection/table path (B's `flc_service` key, A's `{ws}`/`{db}` in
the URL). A then mutates via the data API. A also subscribes to its own path as a positive control.

**Mongo** — `appdb/lart16266x`, A inserts `{secret:"A-ONLY-16266"}`:
```
A's stream  (control): event: insert ... "secret":"A-ONLY-16266"   ← A sees it
B's stream  (probe):   retry: 3000\n\n   (EMPTY)                    ← B sees NOTHING
```
Mechanism: change-stream pipeline `$match` on `fullDocument.tenantId === <verified tenant>`
(realtime-executor `66ea6f0`). B's verified tenant (`a5db1fad…`) ≠ A's doc tenantId
(`ffd33d99…`) → filtered out server-side. **No cross-tenant leak.**

**Postgres** — `public.rt_pg_demo`, A inserts `{id:lart16700x, body:"A-SECRET-16700"}`:
```
A's stream  (control): event: insert + event: delete ... "A-SECRET-16700"   ← A sees it
B's stream  (probe):   retry: 3000\n\n   (EMPTY)                            ← B sees NOTHING
```
Mechanism: per-(table,tenant) NOTIFY channel `flc_rt_<md5(schema.table:tenant_id)>`
(postgres-realtime-executor). A's writes NOTIFY A's tenant-channel; B's LISTEN is on B's
tenant-channel computed from B's *verified* tenant → never receives A's events. **No cross-tenant
leak.** (The trigger derives the channel from the ROW's `tenant_id`, and the data API injects the
caller's tenant_id on write, so a tenant cannot NOTIFY another tenant's channel.)

Auth boundary (both routes): missing `?apikey=` → `401 {"code":"UNAUTHENTICATED"}` (no stream
opened); garbage key → `401`. The tenant identity used for the `$match` / channel is the *verified*
key's tenant, not anything caller-supplied in the path — so spoofing the `{ws}`/`{db}` segments does
not change the tenant scope. This is the correct fail-closed posture.

## BUG RT-1 (P2, functional — Mongo DELETE events never delivered)

**Severity: P2** (functional gap, NOT a security issue — deletes are dropped, never leaked).
Mongo DELETE change events are **never pushed** to subscribers, even though the deployed executor
explicitly enables change-stream pre-images on subscribe and `$match`es deletes on
`fullDocumentBeforeChange.tenantId` (realtime-executor `66ea6f0`).

Isolated empirically (rules out pre-image timing):
- collection created empty → subscribe (executor enables `changeStreamPreAndPostImages`) → insert
  AFTER subscribe → delete. Full lifecycle under pre-images.
- Verified `collMod ... changeStreamPreAndPostImages:{enabled:true}` **succeeds** on this mongo and
  the option is set (`listCollections` options show `{"changeStreamPreAndPostImages":{"enabled":true}}`).
- Result: the `insert` frame is delivered; the `delete` frame is **NOT**:
```
event: insert
data: {"type":"insert","documentId":"6a31b034...","document":{...,"marker":"DEL2-14682",...}}
(no delete frame ever arrives)
```
Likely cause: the executor enables pre-images on the collection at subscribe time but the change
stream's `fullDocumentBeforeChange` is not populated for the delete (so the `$match` delete branch
`fullDocumentBeforeChange.tenantId` matches nothing and the event is dropped) — i.e. the
"best-effort pre-image" path documented in the executor as "deletes are simply not delivered (never
leaked)" is, in practice, the **always** behavior on this stack, not a fallback.

Impact: a realtime subscriber to a Mongo collection is never notified of deletions; clients relying
on the change stream to invalidate caches / sync local state will keep stale/deleted documents. The
Postgres path does NOT have this bug (delete delivered, prior row included).

Repro (one-liner-ish):
```
K=$(mint_key "$TA_TENANT" "$TA_WS" service); C=lartX
( curl -sN -m12 "$EXEC/v1/realtime/workspaces/$TA_WS/data/appdb/collections/$C/changes?apikey=$K" >/tmp/s ) &
sleep 3; exk POST ".../collections/$C/documents" "$K" '{"x":1}'   # -> insert frame appears
# delete the inserted _id via the raw mongo driver (by-id API is broken, see evidence/04)
#   -> NO delete frame ever appears on /tmp/s
```

## Cross-references
- Mongo by-id CRUD broken (evidence/04 BUG): forces use of the raw driver to drive update/delete
  in this test — does not affect the realtime stream behavior itself.
- Shared `in_falcone` DB / shared `falcone_service` role (evidence/03): the pg realtime path
  inherits these; isolation here rides on the data API injecting `tenant_id` on write + the
  per-tenant NOTIFY channel, NOT on DB-level isolation.

## Not tested / out of scope
- Resume/Last-Event-ID replay: the realtime SSE handler (`runRealtimeSse`) does NOT emit `id:`
  lines or honor `Last-Event-ID` (only the flow-monitoring SSE handler does), so there is nothing
  to resume — live-only, no history replay.
- Multi-replica slot behavior (the DocumentDB pgoutput path) — not deployed in this image.
- High-volume / backpressure / NOTIFY 8000-byte truncation (`row` omitted when payload > 7900 B):
  not exercised; the pg trigger drops the `row` field but still NOTIFYs type+id in that case.
