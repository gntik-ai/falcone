# 21 — Document/NoSQL data API (cap-mongo-data-api) on FerretDB/DocumentDB

Live empirical test against the fresh kind deploy (ns `falcone`), 2026-06-17.
Doc DB engine, topology, document CRUD via API key, browse via JWT, direct FerretDB, and
cross-tenant isolation. Tenants: A=acme (`78848e21…`), B=globex (`fe63fa39…`).

## Engine / topology confirmation
- **FerretDB v2.7.0** (NOT MongoDB). `db.runCommand({buildInfo})` via mongo driver →
  `{"version":"7.0.77","ferretdb":{"version":"v2.7.0","package":"docker"},"modules":[]}`.
  The `ferretdb` block in buildInfo is the definitive marker; `version 7.0.77` is the
  MongoDB-wire-compat version it advertises.
- Workloads: `falcone-documentdb-0` (Postgres+DocumentDB ext, the storage engine) +
  2× `falcone-ferretdb-*` (mongo-wire gateway). `kubectl get pods | grep -i mongo` → **no
  MongoDB server**. Confirmed.
- **Topology = ONE shared FerretDB cluster, NO per-tenant db/collection naming.** The database
  and collection names are **caller-supplied** (URL path segments). Both tenants' documents
  co-reside in the same db/collection; the ONLY separation is a `tenantId` field stamped on
  each doc. Proven directly: inserted `{tenantId:A}` and `{tenantId:B}` into the same
  `appdb.lcmongo_shared_probe`; a `{tenantId:A}` filter returned only acme, `{tenantId:B}`
  only globex — the field-filter IS the entire isolation boundary (matches
  `apps/control-plane/src/runtime/mongo-data-executor.mjs` + adapter
  `services/adapters/src/mongodb-data-api.mjs::applyTenantScopeToFilter`).

---

## Per-functionality status

### F1. Document CRUD via API key (`exk`) on EXECUTOR (18082) — **BROKEN (P0 infra)**
- INSERT as A (fixture service key, A's own ws) →
  `POST $EXEC/v1/mongo/workspaces/$TA_WS/data/appdb/collections/{c}/documents`
  → **HTTP 500** `{"code":"CONTROL_PLANE_ERROR","message":"Internal server error"}`.
- ALL executor document ops (insert/list/get/patch/delete) on a caller's OWN workspace → 500.
- Root cause (NOT a code bug in the data path — an infra/label bug): executor log shows
  `MongoServerSelectionError: Server selection timed out after 30000 ms` at
  `mongo-data-executor.mjs:59 clientFor`. The cp-executor pod is labelled
  `{app: falcone-cp-executor}` (manifest `deploy/kind/executor-demo.yaml`), but the Helm
  FerretDB NetworkPolicy `falcone-ferretdb-internal-only` only admits ingress on :27017 from
  pods labelled `app.kubernetes.io/name: control-plane-executor` (or `control-plane`/
  `workflow-worker`). **Label mismatch → executor→FerretDB TCP is dropped (kindnet DOES
  enforce NP on this build).** Proven: raw `net.connect(falcone-ferretdb:27017)` from the
  executor pod → TCP TIMEOUT (5s); the same from the `control-plane` pod (correct label) →
  **connect OK in 2ms**. `directConnection=true` does not help — it's a network-layer block,
  not an SDAM/topology issue.
- ⇒ The tenant-SCOPING data-API executor (the one that injects `{tenantId}`) is effectively
  **unreachable** in this deployment.

### F2. Browse via JWT (acme-ops) on GATEWAY (9080 → control-plane) — **Working, but UNSCOPED (P0)**
All routed by APISIX `/v1/mongo/*` → `falcone-control-plane` (NOT the executor — confirmed in
the APISIX standalone config). The control-plane CAN reach FerretDB (label matches NP).
- `GET /v1/mongo/databases` → **200** `{"items":[{"databaseName":"appdb","stats":{…}}],…}`.
- `GET /v1/mongo/databases/{db}/collections` → **200** with `documentCount`/`estimatedSize`.
- collection detail `…/collections/{c}` → **200** (count/size).
- `…/collections/{c}/indexes` → **200** (lists `_id_` etc).
- `…/views` → **200** (empty).
- Graceful: detail of a non-existent collection → 404 `COLLECTION_NOT_FOUND`.
- `…/databases/{db}` (db detail) → 404 `NO_ROUTE` (unrouted; not a bug).

### F3. Direct FerretDB (mongo driver, admin creds) — **Working**
- `mongodb://<documentdb POSTGRES_USER>:<pw>@localhost:17017/?authSource=admin&directConnection=true`
  → connect OK. (Prior finding **F2 — DocumentDB admin auth — now WORKS** on the fresh build.)
- `listDatabases`, `listCollections`, insert+read direct → all OK.
- The admin connection is a **cross-tenant superuser**: it sees BOTH tenants' data unfiltered
  (see isolation below). User = `falcone_doc_admin` (admin db, authSource admin).

### F4. Engine version — **FerretDB v2.7.0 confirmed** (see top section).

---

## ISOLATION VERDICT — **BROKEN (P0 cross-tenant data breach on the live gateway path)**

### ✅ Cross-WORKSPACE IDOR guard (executor) — PASS
A's fixture API key → B's workspace documents:
`POST/GET $EXEC/v1/mongo/workspaces/$TB_WS/…/documents` →
**403** `{"code":"FORBIDDEN","message":"Credential workspace does not match the requested workspace"}`.
The credential-vs-requested-workspace check fires before any mongo call. Good.

### ❌ Cross-TENANT document READ via JWT on the GATEWAY — **BROKEN (P0)**
The gateway routes `/v1/mongo/.../documents` to the **legacy control-plane**, whose documents
LIST handler does **NOT inject the `{tenantId}` predicate** — it queries FerretDB raw.
- Shared collection `appdb.lcmongo_shared_probe` (held one A-doc + one B-doc):
  - **acme-ops** (JWT `tenant_id=78848e21`, acme) `GET …/data/appdb/collections/{c}/documents`
    → **200**, returns **BOTH** `acme-secret`(A) AND `globex-secret`(B).
  - **globex-ops** likewise sees both.
- Globex-only db `globexonlydb` (created by B, contains only `{tenantId:B, secret:"GLOBEX_PRIVATE"}`):
  - acme-ops `GET …/data/globexonlydb/collections/lcmongo_globex_only/documents` → **200**
    `{"items":[{"_id":"…","tenantId":"fe63fa39-…","secret":"GLOBEX_PRIVATE"}]}` — A reads B's
    private document **content**.
  - With an attacker-controlled `?filter={"secret":"GLOBEX_PRIVATE"}` → 200 same doc
    (arbitrary cross-tenant exfiltration by field).
- Blast radius (live, gateway, JWT): cross-tenant **READ (LIST)** of any other tenant's
  documents in any db/collection name the attacker can guess/enumerate.
- Write ops are NOT exploitable on this path: POST/GET-by-id/PATCH/DELETE on the documents
  route → **404 NO_ROUTE** on the legacy control-plane (only LIST is mapped there); they would
  fall to the executor, which is NP-blocked → 500. So the live exploit is **read/exfiltration**.

### ❌ Cross-TENANT BROWSE/INVENTORY via JWT — **BROKEN (P1, same root cause)**
The browse routes are also unscoped:
- acme-ops `GET /v1/mongo/databases` → lists `globexonlydb` (a DB only globex created).
- acme-ops can read globex's collection list, **documentCount**, **estimatedSize**, and
  index definitions (`…/collections/{c}/indexes` → 200). globex-ops sees acme's likewise.
- ⇒ Any tenant can enumerate every other tenant's database names, collection names, document
  counts, storage stats, and index schemas across the shared cluster.

### Direct FerretDB cross-tenant — admin connection is UNSCOPED (expected for an admin cred)
The DocumentDB admin credential (`falcone_doc_admin`) sees both tenants' data. ADR-14 (per the
code comments) already disproved per-database role scoping at FerretDB v2.7.0, so the per-tenant
credential is documented as "least-privilege audit, not the isolation boundary" — the boundary
is supposed to be the adapter's `tenantId` filter. **The live gateway path does not apply it.**

---

## BUGS

- **P0 — Cross-tenant document & metadata leak on the live Mongo data/browse API.**
  Repro: as acme-ops JWT, `GET $GW/v1/mongo/workspaces/$TA_WS/data/globexonlydb/collections/
  lcmongo_globex_only/documents` → 200 returns globex's `{tenantId:fe63fa39…, secret:GLOBEX_PRIVATE}`.
  Also `GET $GW/v1/mongo/databases` lists other tenants' DBs. The gateway sends `/v1/mongo/*`
  to `falcone-control-plane`, whose handler omits the `{tenantId}` scope that the executor's
  adapter enforces. Affects LIST documents + all browse/inventory routes. Read/exfiltration.
- **P0 (infra) — cp-executor cannot reach FerretDB → every executor document op returns 500.**
  Repro: `POST $EXEC/v1/mongo/workspaces/$TA_WS/data/appdb/collections/{c}/documents` → 500;
  log = `MongoServerSelectionError` to `falcone-ferretdb:27017`. Cause: cp-executor pod label
  `{app: falcone-cp-executor}` doesn't match the FerretDB NetworkPolicy
  `falcone-ferretdb-internal-only` ingress selector (`app.kubernetes.io/name:
  control-plane-executor`); kindnet enforces it → TCP dropped. Fix = add the
  `app.kubernetes.io/name: control-plane-executor` label to the executor pod template
  (`deploy/kind/executor-demo.yaml`), or widen the NP. This is ALSO what forces the gateway to
  use the unscoped legacy control-plane handler (the two bugs compound).
- **P2 — `…/collections/{c}/indexes` on a non-existent collection → 500.** Repro:
  `GET $GW/v1/mongo/databases/appdb/collections/things/indexes` → 500 `{"code":26,…}` (Mongo
  NamespaceNotFound 26 leaking as a 500; sibling collection-detail returns a clean 404).

## NOT-DEPLOYED / out of scope (not bugs)
- `…/databases/{db}` db-detail GET — unrouted (404 NO_ROUTE), feature not exposed.
- Document write/by-id ops via the gateway — not routed on the legacy control-plane (404);
  only reachable via the executor (currently NP-blocked).

## Couldn't test (blocked by the executor NP bug)
- Document CRUD WRITE round-trip through the proper tenant-scoping executor (insert→read→patch→
  delete with the `{tenantId}` adapter scope and the documented `_id` ObjectId coercion) — the
  executor never reaches FerretDB on this deploy, so the scoped data path could not be
  exercised end-to-end. The scoping LOGIC was verified directly against FerretDB (filter
  `{tenantId:A}` vs `{tenantId:B}` isolates correctly); what is broken is that the LIVE
  gateway uses a different, unscoped handler.
