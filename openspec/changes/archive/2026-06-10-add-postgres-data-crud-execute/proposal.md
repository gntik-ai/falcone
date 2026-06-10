## Why

`services/adapters/src/postgresql-data-api.mjs::buildPostgresDataApiPlan` (line 1793) produces a complete execution plan — `{sql:{text,values}, operation, command, effectiveRoleName, access, trace}` — for every row-CRUD, bulk, and RPC operation, but no code path ever calls `pg.query()` or any equivalent against the workspace database. The plan is built, returned, and discarded: `apps/control-plane/src/postgres-data-api.mjs` imports and re-exports the surface symbols but contains no executor. The public routes declared in `apps/control-plane/openapi/families/postgres.openapi.json` (`/v1/postgres/workspaces/{id}/data/{db}/schemas/{schema}/tables/{table}/rows`, `/rows/by-primary-key`, `/bulk/*`, `/rpc/{routine}`) and the simplified facade in `services/gateway-config/public-route-catalog.json` (`/v1/collections/{name}/documents`, `/v1/collections/{name}/query`) are live gateway paths that return nothing. RLS context machinery (`services/adapters/src/postgresql-data-api.mjs::buildRlsClause`, `buildTraceSettings`) is fully authored but never exercised at runtime.

## What Changes

- Implement `executePostgresDataApiPlan(plan, connectionRegistry)` in the control-plane data path: acquire a workspace connection under the caller's RLS context, emit the `SET LOCAL` session settings from `plan.trace.sessionSettings`, run `plan.sql.text` with `plan.sql.values`, and release the connection.
- Wire the executor into each route handler for `list`, `get`, `insert`, `update`, `delete`, `bulk_insert`, `bulk_update`, `bulk_delete`, `rpc`, and `export` so every operation completes end-to-end.
- Honor all plan fields already computed: filters, keyset pagination (`page[size]`/`page[after]`), `order`, `count` modes (`none`/`exact`/`estimated`), one-hop relation joins, `RETURNING` columns on mutations.
- Run under the caller's RLS role (`plan.effectiveRoleName`) so anon-key callers see only RLS-permitted rows and `WITH CHECK` silently blocks cross-tenant writes without server-side changes.
- Map pg driver errors to sanitized HTTP responses: constraint violations → 409, invalid input → 400, RLS policy denial → 403, others → 500 with opaque reference ID.
- Reuse `add-control-plane-executor` connection infrastructure and `add-workspace-db-connection-registry` RLS-context acquisition; no new connection logic.

## Capabilities

### New Capabilities

### Modified Capabilities

- `data-api`: Row CRUD plans produced by `buildPostgresDataApiPlan` are now executed against the workspace Postgres database under the caller's RLS context; all filtering, pagination, relation, count, and bulk semantics are live.

## Impact

- `apps/control-plane/src/postgres-data-api.mjs` — add `executePostgresDataApiPlan`; wire into route handlers for all ten operations.
- `services/adapters/src/postgresql-data-api.mjs::buildPostgresDataApiPlan` — reused unchanged as plan source.
- `services/adapters/src/postgresql-data-api.mjs::buildRlsClause` / `buildTraceSettings` — exercised at runtime for the first time.
- `apps/control-plane/openapi/families/postgres.openapi.json` — routes remain unchanged; responses now carry real data.
- `services/gateway-config/public-route-catalog.json` routes `/v1/collections/{name}/documents` and `/v1/collections/{name}/query` (`privilege_domain: data_access`) become functional.
- `add-control-plane-executor` (prereq): provides connection pool; `add-workspace-db-connection-registry` (prereq): provides RLS-context acquisition.
- `add-app-api-keys` + `add-console-rls-policies` (pairing): anon-key / service-key resolution and per-table RLS policies that the executor enforces.
