## Why

`ConsolePostgresPage.tsx` (lines 1335-1382) renders a read-only policy list for
user tables but provides no authoring surface. The policy CRUD API already exists
(`/v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/policies`,
`postgres.openapi.json` lines 15531 and 15831) and `renderPolicyStatement` in
`services/adapters/src/postgresql-governance-admin.mjs` (lines 191-199) can emit
validated `CREATE POLICY ... USING(...) WITH CHECK(...)` DDL. User-created (app)
tables are never covered by `ENABLE ROW LEVEL SECURITY`; the service-table RLS
enablement path (`buildPostgresGovernanceSqlPlan::table_security`, line 547) exists
but is not triggered for tenant app tables. With no RLS on app tables, an anon-key
caller can read any row across all tenants — exactly the isolation gap the audit
flagged as `feat-enable-rls-on-all-tables`.

## What Changes

- Add a console policy builder to `ConsolePostgresPage`: a form accepting
  `policyName`, `policyMode` (permissive/restrictive), command, target roles,
  `usingExpression`, `withCheckExpression`; preview the generated SQL (via
  `buildPostgresGovernanceSqlPlan`); and apply via the executor.
- Generalize the `table_security` SQL plan path to accept user-created (app)
  tables: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` on any
  tenant-owned table in the workspace database.
- Map the two DB roles (`anon` / `service_role`, from `add-app-api-keys`) to
  policy predicates: anon policies default to read-only + row filter; service-role
  policies default to unrestricted; both are overridable.
- Enforce fail-closed default-deny: when RLS is enabled and no applicable policy
  exists, `evaluatePostgresDataApiAccess` already returns
  `{ allowed: false, reason: 'no_applicable_rls_policy' }` — surface this
  clearly in the console security tab.
- Expose a `POST /v1/postgres/.../policies` write path through the executor so
  policy mutations issued from the console go through the same DDL-preview +
  acknowledgement flow as other governance DDL.

## Capabilities

### New Capabilities

- `access-policies`: Console-driven RLS policy authoring over user tables; per-table
  ENABLE/FORCE RLS generalised to app tables; anon vs service-role predicate mapping;
  fail-closed default-deny surface.

### Modified Capabilities

## Impact

- `apps/web-console/src/pages/ConsolePostgresPage.tsx` — add policy-builder form
  with SQL preview panel in the `policies` tab; add `ENABLE RLS` toggle in the
  `security` tab; currently read-only.
- `services/adapters/src/postgresql-governance-admin.mjs::buildPostgresGovernanceSqlPlan`
  — `table_security` branch already emits `ENABLE / FORCE ROW LEVEL SECURITY`
  (lines 547-549); no change to core logic; gateway/executor must accept the
  statement for app tables (previously only called for service tables).
- `apps/control-plane/src/postgres-admin.mjs` — add `POST` handler for
  `.../policies` and `PUT/DELETE` for `.../policies/{policyName}` delegating to
  `buildPostgresGovernanceSqlPlan` + executor; executor plan preview endpoint
  already used by other DDL surfaces.
- `apps/control-plane/openapi/families/postgres.openapi.json` — policy write
  operations (create/update/delete) already modelled (line 15531+, 15831+) but
  not yet wired to a mutation handler; wire them up.
