# add-auto-rest-data-api

## Why

The single feature every Supabase / Firebase / Appwrite / Pocketbase user reaches for
first is *"I created a table, now I have an API."* Falcone today exposes:

- a generic CRUD adapter (`/v1/postgres/.../sql`, list/get/insert/update/delete/rpc per
  [[data-services]] D1) that the client must call with raw SQL or a generic body,
- a structural admin surface to create tables, indexes, RLS policies,
- but **no auto-generated, per-table, REST endpoints** that a JavaScript or mobile SDK
  can use without operator privileges.

This is the difference between "we have a Postgres adapter" and "we are a BaaS." Without
it, the only practical way to query data from a browser is to write a server-side
function for every operation — the exact friction BaaS exists to remove.

The building blocks are all present: D1 already wraps Postgres with RBAC; the new
[[add-tenant-api-keys]] proposal provides the `publishable` / `service_role` key model;
and Postgres RLS is already a deployment baseline. What is missing is the
*resource-shaped* surface that maps `GET /v1/data/{workspaceId}/{table}` →
`SELECT ... WHERE ...` under RLS, and the **policy authoring API** that lets tenants
declare which tables are publicly readable, who can insert what, and which columns are
returned.

## What Changes

1. **New route family `/v1/data/...`** owned by [[data-services]]:
   - `GET    /v1/data/{workspaceId}/{schema}.{table}` — list with `?select=`, `?filter=`,
     `?order=`, `?limit=`, `?offset=`, `?cursor=` (PostgREST-compatible filter syntax,
     plus a `cursor=` extension for keyset pagination).
   - `GET    /v1/data/{workspaceId}/{schema}.{table}/{primaryKey}` — single-row read.
   - `POST   /v1/data/{workspaceId}/{schema}.{table}` — insert one or many; supports
     `Prefer: return=representation|minimal|headers-only` and `resolution=merge-duplicates`.
   - `PATCH  /v1/data/{workspaceId}/{schema}.{table}` — update with filter expression.
   - `DELETE /v1/data/{workspaceId}/{schema}.{table}` — delete with filter expression.
   - `POST   /v1/data/{workspaceId}/rpc/{functionName}` — call a SQL function.
2. **API exposure controls** so tables and functions are opt-in:
   - `PUT  /v1/postgres/workspaces/{workspaceId}/{dbName}/exposed-tables/{schema}.{table}`
     `{ enabled, operations: ["select","insert","update","delete"], maxRows, allowAnon }`.
   - `PUT  /v1/postgres/workspaces/{workspaceId}/{dbName}/exposed-functions/{name}`
     `{ enabled, allowAnon, returnsTable }`.
   - `GET  /v1/postgres/workspaces/{workspaceId}/{dbName}/exposed-tables` — list with
     RLS-policy summary and column-projection rules.
3. **RLS policy authoring API** so tenants can author policies via JSON instead of raw SQL:
   - `GET|PUT|DELETE /v1/postgres/workspaces/{workspaceId}/{dbName}/tables/{schema}.{table}/policies/{policyName}`
     `{ command: "select|insert|update|delete|all", roles: ["anon","authenticated","service_role"],
        using: <safe-expr>, withCheck?: <safe-expr>, description }`.
   - Backed by `CREATE POLICY` + `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` under the
     governance adapter.
4. **JWT companion claims** so RLS can discriminate end-users behind a publishable key:
   - When a request carries `apikey: sbp_*` and an `Authorization: Bearer <end-user JWT>`
     issued by Keycloak's tenant realm, the data API sets:
     `SET LOCAL request.jwt.claims = '{...}'`, `SET LOCAL role = 'authenticated'`.
   - When only `apikey: sbp_*` is present, `role = 'anon'`.
   - When `apikey: sbs_*` is present, `role = 'service_role'`.
5. **OpenAPI per-workspace augmentation.** The [[gateway-and-public-surface]] SDK
   generator extends the per-workspace OpenAPI with the live list of exposed tables so
   the generated TypeScript/Python SDK is fully typed against the customer's schema.
6. **Per-table quota & dashboards.** Plan dimensions `data_api.requests_per_minute` and
   `data_api.payload_bytes_max` enforced at gateway; per-table read/write counts surfaced
   in the workspace overview.

## Impact

- **Affected specs**:
  - `openspec/specs/data-services/spec.md` — adds REQs for `/v1/data/...`, exposure
    controls, RLS authoring API, JWT companion claims.
  - `openspec/specs/gateway-and-public-surface/spec.md` — SDK generator must consume
    exposed-tables list (cross-capability dep; deferred to that capability's own spec
    round, this proposal only declares the contract).
- **Affected code**:
  - `apps/control-plane/openapi/families/data.openapi.json` (new), and an extension to
    `postgres.openapi.json` for exposed-tables/policies.
  - `services/adapters/src/postgresql-data-api.mjs` — gains a request-translation layer
    that compiles `?select=`/`?filter=`/`?order=` to safe SQL using a parser
    (allowlisted operators, parameterised values, no string interpolation).
  - `services/adapters/src/postgresql-governance-admin.mjs` — gains policy CRUD.
  - `services/provisioning-orchestrator/src/migrations/NNN-exposed-tables.sql` — table
    `exposed_data_entities (tenant_id, workspace_id, db_name, schema, name, kind,
    operations, allow_anon, max_rows, ...)`.
  - `services/openapi-sdk-service/src/capability-modules/data-api.paths.json` — new
    capability module mounted per-workspace once tables are exposed.
- **Dependencies**: [[add-tenant-api-keys]] (provides `anon`/`service_role` resolution at
  the gateway). Without it the data API has no client-side authentication story.
- **No breaking changes** — existing `/v1/postgres/...` admin & generic-CRUD endpoints
  remain. The new family is additive; opt-in per table.
- **Security**: filter parser MUST allow only documented operators (`eq, neq, gt, gte,
  lt, lte, in, like, ilike, is, fts, plfts, phfts, wfts, cs, cd, ov, sl, sr, nxr, nxl,
  adj, not.*`); column references are validated against `information_schema`; no raw SQL
  pass-through on `/v1/data/...`.
