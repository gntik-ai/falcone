# Evidence: C13–C16 — PostgreSQL and MongoDB Data APIs + Direct Datastore Access

**Subagent run:** 2026-06-18  
**Cluster:** kind test-cluster-b, namespace `falcone`  
**Keycloak status:** DEGRADED — KC pod restarted (restartCount=1), realm `in-falcone-platform` lost; JWT-gated routes (management/DDL provisioning via GW/CP) return 401. API-key and trust-header executor paths are unaffected.

---

## C13 — PostgreSQL Data API

### Auth paths verified
| Path | Auth | Works? |
|---|---|---|
| `EXEC /v1/postgres/databases/*/schemas` (DDL) | trust-header (`x-tenant-id`/`x-workspace-id`) | YES |
| `EXEC /v1/postgres/workspaces/*/data/*/rows` (CRUD) | apikey (`Authorization: ApiKey flc_…`) | YES |
| `GW /v1/postgres/workspaces/*/data/*/rows` (CRUD) | apikey (`apikey: flc_…` header) | YES |
| `GW /v1/postgres/databases/*` (DDL, JWT-gated) | Bearer JWT | 401 — KC down |

### DDL — Create schema
```
POST EXEC /v1/postgres/databases/wsdb_acme_app_staging/schemas
body: {"name":"lcschema"}
→ 201 {"executed":true,"executionMode":"execute","statementCount":1,
        "statements":["CREATE SCHEMA IF NOT EXISTS \"lcschema\""]}
```

### DDL — Create table

**Contract mismatch (BUG):** The route catalog spec uses `{name, columns[{name, type}]}` but the executor structural-admin validates `columnName/dataType` keys. Sending `{name:"lctable", columns:[{name:"id", type:"uuid"}]}` → 400 `DDL_INVALID: Invalid tableName identifier`.  
Correct contract: `{tableName:"lctable", columns:[{columnName:"id", dataType:"uuid", ...}]}`

```
POST EXEC /v1/postgres/databases/wsdb_acme_app_staging/schemas/lcschema/tables
body: {"tableName":"lctable","columns":[{"columnName":"id","dataType":"uuid","primaryKey":true,"nullable":false,"defaultValue":"gen_random_uuid()"},{"columnName":"payload","dataType":"text"},{"columnName":"created_at","dataType":"timestamptz","nullable":false,"defaultValue":"NOW()"}]}
→ 201 {"executed":true,"executionMode":"execute","statementCount":7,
        "statements":[
          "CREATE TABLE \"lcschema\".\"lctable\" (...)",
          "ALTER TABLE \"lcschema\".\"lctable\" ADD COLUMN IF NOT EXISTS \"tenant_id\" text NOT NULL DEFAULT current_setting('app.tenant_id', true)",
          "GRANT USAGE ON SCHEMA \"lcschema\" TO \"falcone_service\", \"falcone_anon\"",
          "GRANT SELECT, INSERT, UPDATE, DELETE ON \"lcschema\".\"lctable\" TO ...",
          "ALTER TABLE \"lcschema\".\"lctable\" ENABLE ROW LEVEL SECURITY",
          "ALTER TABLE \"lcschema\".\"lctable\" FORCE ROW LEVEL SECURITY",
          "CREATE POLICY \"lctable_tenant_isolation\" ON \"lcschema\".\"lctable\" USING (\"tenant_id\" = current_setting('app.tenant_id', true)) WITH CHECK (...)"
        ]}
```

**Isolation DDL confirmed:** table auto-gets `tenant_id` NOT NULL column, RLS ENABLED, FORCE RLS, and a `{tableName}_tenant_isolation` policy on both USING and WITH CHECK.

**BUG — PK not created (P2):** `primaryKey:true` on a column definition does NOT create an actual PRIMARY KEY constraint in the database. Direct PG check confirms `pk.rows = []`. The data API's `introspectTable()` queries `pg_index.indisprimary` → empty → `PLAN_REJECTED: Table must declare a primary key`. Without a separate out-of-band `ALTER TABLE ADD CONSTRAINT` the table is unusable for CRUD. No DDL route exists for constraints in the executor (`DELETE /v1/postgres/databases/*/schemas/*/tables/*` and `POST .../constraints` → 404).

### DDL — Create index
```
POST EXEC /v1/postgres/databases/wsdb_acme_app_staging/schemas/lcschema/tables/lctable/indexes
body: {"tableName":"lctable","schemaName":"lcschema","indexName":"lctable_payload_idx","columns":["payload"],"indexMethod":"btree"}
→ 201 {"executed":true,"statementCount":1,"statements":["CREATE INDEX \"lctable_payload_idx\" ON \"lcschema\".\"lctable\" USING BTREE (\"payload\")"]}
```

### DDL — Vector search
pgvector extension not installed: `SELECT * FROM pg_extension WHERE extname='vector'` → 0 rows. Attempting to add a `vector` column returns `SYNTAX_OR_ACCESS: Invalid statement` (extension missing from the DB, CREATE EXTENSION fails with "not available").

### CRUD (after manually adding PK via direct PG)

**Insert contract:** `{row:{...}}` or `{values:{...}}` or flat fields — all accepted; executor uses `c.body.row ?? c.body.values ?? c.body`.

```
POST EXEC /v1/postgres/workspaces/{wsId}/data/{db}/schemas/{schema}/tables/{table}/rows
body: {"row":{"payload":"secret_acme_data","id":"11111111-...","created_at":"2026-06-18T12:00:00Z"}}
→ 201 {"item":{...,"tenant_id":"676c519b-..."},"affected":1,
        "access":{"reason":"grant_and_rls_allow","rlsEnforced":true,"rowPredicateRequired":false}}
```

```
GET  .../rows                              → 200 items[] with RLS filter
GET  .../rows/by-primary-key?id=...        → 200 found:true item
PATCH .../rows/by-primary-key?id=...       body:{"changes":{...}} → 200
DELETE .../rows/by-primary-key?id=...      → 200 deleted
POST .../rows/bulk/insert                  body:{"rows":[...]}    → 201 items[]
```

**Bulk insert path:** `/rows/bulk/insert` (NOT `/bulk/insert`). The route catalog path `/bulk/insert` → 404.

**Admin SQL:** `POST /v1/postgres/workspaces/{ws}/admin/{db}/sql` → 404 (not mapped in executor).

---

## C14 — Direct PostgreSQL

**Connection:** `host=localhost:15432 user=falcone` (shared credential for all workspaces).

**Role check (empirical):**
```sql
SELECT current_user, current_setting('is_superuser'), rolbypassrls, rolsuper FROM pg_roles WHERE rolname=current_user;
-- → current_user=falcone, is_superuser=off, rolbypassrls=false, rolsuper=false
```
`falcone` is NOT a superuser, NOT bypassrls. RLS applies.

**RLS enforcement (empirical):**
```
SET app.tenant_id = '676c519b-...' (acme) → SELECT returns acme rows
SET app.tenant_id = '64443b6c-...' (globex) → SELECT returns 0 rows (FORCE RLS blocks cross-tenant)
```
RLS fail-closes correctly. The `falcone` user cannot read another tenant's data by changing the GUC.

**falcone_service/falcone_anon roles:**
```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname LIKE 'falcone_%';
-- falcone_anon:    rolsuper=false, rolbypassrls=false
-- falcone_service: rolsuper=false, rolbypassrls=false
```
Neither role bypasses RLS.

**Cross-DB (expected shared cred):** `falcone` user can connect to `wsdb_acme_app_staging` AND `wsdb_globex_app_staging` directly — this is the known shared-credential reality (per operator note). Tenant isolation within each DB is enforced by RLS + `app.tenant_id` GUC.

**Platform DB:** `falcone` user connecting to `in_falcone` can read the `tenants` table (slug, tenant_id for all tenants). This is expected for the application credential used by the control-plane.

---

## C15 — Mongo/FerretDB Data API

### Mongo DB provisioning (broken contract — P1)

Fixtures showed `400 VALIDATION_ERROR: database name is required` when provisioning `{engine:"mongodb"}`. Investigation reveals:
- The kind control-plane handler reads `ctx.body?.name` (NOT `databaseName`)
- The correct body is `{"engine":"mongodb","name":"my_db_name"}`
- The seeding script attempted `{engine:"mongodb","databaseName":"..."}` → validation error
- This means NO workspace-level mongo DB is provisioned for any tenant from the fixtures
- Route `POST /v1/workspaces/{ws}/databases` requires a JWT (KC is down); cannot re-test with correct body now

### Mongo CRUD (works without pre-provisioned DB)

The executor mongo data API does NOT require a pre-provisioned DB — FerretDB creates collections on demand.

```
POST EXEC /v1/mongo/workspaces/{wsId}/data/{dbName}/collections/{coll}/documents
body: {"document":{"_id":"lc_doc_001","name":"secret_acme_item","value":42}}
→ 201 {"item":{...,"tenantId":"676c519b-...","_id":"lc_doc_001"},"insertedId":"lc_doc_001"}
```
`tenantId` auto-stamped from the credential's resolved tenant.

```
GET  .../documents                         → 200 items[] (tenant-filtered)
GET  .../documents/{id}                    → 200 found:true item
PATCH .../documents/{id}  body:{"update":{"$set":{...}}} → 200 matched:1 modified:1
PUT  .../documents/{id}   body:{"document":{...}}        → 200 (replace)
DELETE .../documents/{id}                  → 200 deleted:1
```

**Aggregation:** `POST .../aggregations` → 404 (not mapped in executor; route in catalog only).

**GW path:** Both `apikey:` header (GW) and `Authorization: ApiKey` (EXEC) work identically.

---

## C16 — Direct FerretDB

**Connection:** `mongodb://localhost:17017/?directConnection=true` with admin creds (`falcone_doc_admin`).

**Engine confirmation:**
```
admin.command({buildInfo:1})
→ version: "7.0.77", ferretdb: {version: "v2.7.0", package: "docker"}
```
Confirmed FerretDB v2.7.0 presenting as MongoDB 7.0.77. NOT a MongoDB server.

**Direct cross-tenant data access (admin cred):**
The admin credential can read documents from ALL tenants' collections directly:
```js
// Shared collection "lcshared.lccommon" used by both tenants
await client.db('lcshared').collection('lccommon').find({}).toArray()
// → [{_id:"acme_shared_doc", tenantId:"676c519b-..."}, {_id:"globex_shared_doc", tenantId:"64443b6c-..."}]
```
This is the expected shared-credential reality: FerretDB has ONE cluster, tenants are separated by `tenantId` field (no DB-per-tenant or role-per-tenant). Admin bypasses field-level scoping. The API enforces scoping via the executor; direct admin access is unguarded.

---

## Isolation Probes

### PG Row Isolation — PASS

| Probe | Expected | Actual |
|---|---|---|
| Key B reading Acme's workspace data | 403 | `403 FORBIDDEN: Credential workspace does not match the requested workspace` |
| Key A with Globex workspace ID in path | 403 | `403 FORBIDDEN` |
| Key B inserting into Acme's workspace | 403 | `403 FORBIDDEN` |
| Cross-env: staging key → prod workspace | 403 | `403 FORBIDDEN` |
| Trust-header spoof: B tenant + A workspace | 403 | `403 CROSS_TENANT_VIOLATION: Workspace does not belong to the caller's tenant` |
| Direct PG: globex tenant_id GUC → acme data | empty | 0 rows (FORCE RLS blocks) |

### Mongo API Isolation — PASS

| Probe | Expected | Actual |
|---|---|---|
| Key B reading Acme workspace | 403 | `403 FORBIDDEN` |
| Key A with Globex workspace ID | 403 | `403 FORBIDDEN` |
| Key B inserting into Acme workspace | 403 | `403 FORBIDDEN` |
| Trust-header spoof: B tenant + A workspace | 403 | `403 CROSS_TENANT_VIOLATION` |
| Same collection name, A reads B's docs | only A's | Only A's tenantId docs returned |
| Same collection name, B reads A's docs | only B's | Only B's tenantId docs returned |

### Direct PG Isolation — PASS (RLS enforced)

falcone user with globex tenant GUC cannot read acme's rows (FORCE RLS + policy blocks). Both tenant DBs are accessible with shared cred but RLS prevents cross-read.

### Direct FerretDB Isolation — SHARED CRED REALITY (expected)

Admin cred bypasses tenantId field filter and can read all tenants' documents. This is the known architecture (one shared FerretDB cluster, no DB-per-tenant, no per-tenant role). The API layer correctly enforces scoping; direct admin access is unguarded (P2 documentation gap, not a regression).

---

## Bugs Found

### BUG-C13-PK: DDL `primaryKey:true` does not create PK constraint (P2)
- **Surface:** `POST /v1/postgres/databases/{db}/schemas/{schema}/tables` (executor)
- **Repro:** Create table with `{tableName:"t", columns:[{columnName:"id", dataType:"uuid", primaryKey:true}]}`. Direct PG check: `pg_index.indisprimary` = empty. Data API (`GET /rows`) returns `400 PLAN_REJECTED: Table t must declare a primary key`.
- **Root cause:** `postgres-ddl-executor.mjs` `buildDdlPlan` for `table` action calls `buildPostgresStructuralSqlPlan` which generates `CREATE TABLE` but the `primaryKey:true` flag on a column in the structural builder does not emit `PRIMARY KEY` constraint SQL — no `ALTER TABLE ADD PRIMARY KEY` is added by `tableIsolationStatements`. The data API's `introspectTable` queries `pg_index.indisprimary` and finds nothing.
- **Impact:** Any table created via the DDL API is unusable for CRUD (PLAN_REJECTED). User must add PK out-of-band via direct DB access.

### BUG-C13-BODY: DDL `name`/`type` column keys rejected (P2)
- **Surface:** `POST /v1/postgres/databases/{db}/schemas/{schema}/tables`
- **Repro:** `{"tableName":"t", "columns":[{"name":"id","type":"uuid"}]}` → `400 DDL_INVALID: Invalid tableName identifier`
- **Root cause:** `validateColumnRules` in `postgresql-structural-admin.mjs` reads `columnName` and `dataType` keys, not `name`/`type`. The route catalog / public API docs use `name`/`type`. Contract mismatch between the spec and implementation.

### BUG-C15-MONGO-PROVISION: Workspace mongo DB provisioning uses `name` not `databaseName` (P2)
- **Surface:** `POST /v1/workspaces/{ws}/databases` with `{engine:"mongodb"}`
- **Repro:** `{"engine":"mongodb","databaseName":"mydb"}` → `400 VALIDATION_ERROR: database name is required`. Correct field is `name`.
- **Root cause:** `deploy/kind/control-plane/mongo-handlers.mjs:206` reads `ctx.body?.name`; the seeding script and likely the public docs use `databaseName`.

### BUG-C13-BULK: Bulk insert route path mismatch (P2)
- **Surface:** Route catalog path `POST .../tables/{tableName}/bulk/insert` → 404
- **Correct path:** `POST .../tables/{tableName}/rows/bulk/insert` (as defined in `server.mjs:278`)
- **Impact:** Clients following the public route catalog for bulk inserts will get 404.

### NOT-DEPLOYED: pgvector (vector search)
- Extension `vector` not available in the Postgres image: `CREATE EXTENSION IF NOT EXISTS vector` → `extension "vector" is not available`. All vector column/index DDL returns `SYNTAX_OR_ACCESS: Invalid statement`.

### NOT-DEPLOYED: Mongo aggregation (`POST .../aggregations`)
- Route exists in catalog but executor `server.mjs` has no aggregation handler → 404.

### INFRASTRUCTURE ISSUE: Keycloak realm lost on restart
- KC pod restarted (restartCount=1); realm `in-falcone-platform` lost; `GET /realms/in-falcone-platform/...` → `Realm does not exist`. All JWT-gated management routes (workspace provisioning, user management, etc.) return 401 for the duration of this test run.
- Not a code bug; infrastructure stability issue for the test cluster.
