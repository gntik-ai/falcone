# Evidence — Postgres Data API + cross-tenant isolation (live `falcone` namespace)

Target: kind test-cluster-b, ns `falcone`, Helm `in-falcone-0.3.0` rev 47.
Fixtures: Tenant A = Ops Demo (`ffd33d99…`, ws `9dfb3614…`, db path `wsdb_ops_demo_0610_ops_ws`);
Tenant B = DataPlane Demo (`a5db1fad…`, ws `7d155cef…`, db path `wsdb_dp_demo_0510_primary`).
Auth: real `flc_service_*` API keys minted per workspace (proper credential path).

## Architecture as actually wired (code + empirical)

- `apps/control-plane/src/runtime/main.mjs:56-57`

  ```js
  const dsn = dataDsn();              // PGDATABASE=in_falcone (executor env)
  const resolveConnection = () => ({ dsn });   // <-- ignores workspaceId
  ```

  → Every workspace's data-plane request (CRUD **and** DDL) runs against the **single shared
  `in_falcone` database** (the control-plane metadata DB). The per-workspace databases that
  provisioning created (`wsdb_ops_demo_0610_ops_ws`, `wsdb_dp_demo_0510_primary`) are **never
  connected to** — orphaned. (`grep` of all DBs: the schema a DDL call created landed in
  `in_falcone`, not the workspace DB.)
- Data path runs as the API key's DB role: service key → `falcone_service`, anon key →
  `falcone_anon` (both shared across ALL tenants). DDL path runs as owner `falcone`.
- Per-row isolation in the data executor is **column-driven**: a table **with** a `tenant_id`
  column gets an app-level predicate (`access.reason=grant_and_rls_filter, rlsEnforced:true`);
  a table **without** one gets none (`access.reason=grant_only, rlsEnforced:false`).

## FINDING PG-1 (CRITICAL, tenant-isolation) — cross-tenant read/write/delete of user tables

A table created through the public DDL API has no `tenant_id` column, no RLS, and is owned by
`falcone`. Once it is readable by the shared `falcone_service` role (the only way the data API
can use it — see PG-2), **any tenant can read, modify and delete any other tenant's rows.**

Empirical proof (real `flc_service` keys, real data API on the executor):

```
Tenant A creates schema leak_13969 + table secrets(id int PK, note text) via DDL API.
A's row: {id:1, note:"TENANT-A-CONFIDENTIAL"}.

GET .../workspaces/<A_ws>/data/<A_db>/schemas/leak_13969/tables/secrets/rows   (A key)
 -> 200 {items:[{id:1,note:"TENANT-A-CONFIDENTIAL"}], access:{reason:"grant_only",rlsEnforced:false}}

GET .../workspaces/<B_ws>/data/<B_db>/schemas/leak_13969/tables/secrets/rows   (B key, B path)
 -> 200 {items:[{id:1,note:"TENANT-A-CONFIDENTIAL"}]}          # B READS A's data

POST .../workspaces/<B_ws>/data/<B_db>/schemas/leak_13969/tables/secrets/rows  (B key) {id:99,note:"PLANTED-BY-TENANT-B"}
 -> 201    # B WRITES into A's table; A subsequently sees id=99

DELETE .../by-primary-key?id=1  (B key, B path)
 -> 200 {affected:1}   # B DELETES A's confidential row; gone from A's view
```

Root cause: `resolveConnection` ignores `workspaceId` (shared DB) + shared `falcone_service`
role + no RLS/tenant-scoping on DDL-created tables. Cross-tenant IDOR is the cardinal BaaS bug.

## FINDING PG-2 (HIGH, functional) — DDL→data round-trip is broken end-to-end

DDL (`POST /v1/postgres/databases/{db}/schemas/{s}/tables`) emits only
`CREATE TABLE … (…)` — **no GRANT to `falcone_service`/`falcone_anon`, no RLS, no tenant column**
(verified: grants list shows only owner `falcone`; `relrowsecurity=false`). The data API runs as
the api-key role, so every CRUD call on an API-created table returns:

```
{"code":"TABLE_NOT_FOUND","message":"Table <schema>.<table> not found"}   HTTP 404
```

→ You cannot create a table via the API and then use it via the API. The data API is effectively
non-functional for self-provisioned tables. (PG-1 was only demonstrable after manually granting
`falcone_service`, which a correct provisioning path would have to do — and doing so without RLS
is exactly what opens PG-1.)

## FINDING PG-3 (HIGH, least-privilege) — shared data role can reach control-plane tables

The data API connects to `in_falcone`, where the shared `falcone_service` role holds SELECT on
control-plane-adjacent tables, including **`public.workspace_api_keys`** (12 rows, 7 tenants:
`id, tenant_id, workspace_id, key_type, key_prefix, key_hash, scopes, status,…`), plus `cap_pg`,
`rt_pg_demo`, `workspace_embedding_mappings`. These have **no RLS** (`relrowsecurity=false`).
Reading `workspace_api_keys` via a tenant key returned only the caller's rows **because the
executor injects the tenant_id predicate** (the table has a `tenant_id` column) — i.e. the only
thing preventing a cross-tenant key-metadata dump here is the app-level predicate, not the
database grant. Any such table **without** a `tenant_id` column would leak (see PG-1).
`demo_notes` by contrast is correct: `relrowsecurity` forced + policy
`tenant_id = current_setting('app.tenant_id')` — the pattern that should be applied uniformly.

## Status

- DDL create schema/table: **WORKING** (correct payload: column `nullable:false` +
  `constraints.primaryKey:true`).
- Data CRUD on API-created tables: **BROKEN** (PG-2).
- Tenant isolation of user data: **BROKEN** (PG-1) — read+write+delete cross-tenant proven.
- Vector/KNN search, bulk insert, filters/pagination: not yet exercised (blocked by PG-2 for
  API-created tables; would need a `falcone_service`-granted table).

## Repro

`bash tests/live-audit/specs/03-postgres-isolation.sh` (uses lib/lib.sh + context.env; mints keys).
Cleanup of planted schemas: `leak_*`, `audit_*` in `in_falcone` (test residue) — see specs script.
