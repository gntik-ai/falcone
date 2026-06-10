## Context

`ConsolePostgresPage.tsx` already fetches and displays the policy list for the
selected table (lines 1335-1382) and the security panel (`rlsEnabled`, `forceRls`,
`policyCount`) — but both views are strictly read-only. The API contract for policy
mutation (POST/PUT/DELETE under `.../tables/{tableName}/policies`) is modelled in
`apps/control-plane/openapi/families/postgres.openapi.json` (lines 15531+, 15831+)
but no write handler is wired in `apps/control-plane/src/postgres-admin.mjs`.

DDL generation is complete: `buildPostgresGovernanceSqlPlan` in
`services/adapters/src/postgresql-governance-admin.mjs` emits
`CREATE POLICY ... USING(...) WITH CHECK(...)` and
`ALTER TABLE ... ENABLE/DISABLE/FORCE ROW LEVEL SECURITY` with full validation and
safe-guard commentary (lines 513-624). The executor + DDL-preview flow is already
used by other governance operations (table DDL, index DDL).

The `evaluatePostgresDataApiAccess` function (lines 656-709) already models
fail-closed default-deny: when `applicablePolicies.length === 0` it returns
`{ allowed: false, reason: 'no_applicable_rls_policy' }`. This is the runtime
contract; the console must surface it.

## Goals / Non-Goals

**Goals:**
- Console policy-builder form (create/update/delete) with SQL preview before apply.
- ENABLE/FORCE RLS toggle in the console security tab for app tables.
- Wire the existing `POST/PUT/DELETE .../policies` routes to mutation handlers in
  `postgres-admin.mjs`.
- Anon vs service-role predicate mapping with preset templates in the form.
- Surface default-deny state in the security panel when `rlsEnabled && policyCount === 0`.

**Non-Goals:**
- Row-level access enforcement at the database session layer (Postgres enforces this
  natively once the DDL is applied; no application-layer shim needed).
- Realtime event delivery changes (deferred per locked decisions).
- Per-row audit events for RLS-filtered rows (observability follow-on).

## Decisions

**D1 — Reuse `buildPostgresGovernanceSqlPlan` for all policy DDL.**
Rationale: The function already handles `ENABLE ROW LEVEL SECURITY`, `FORCE`,
`CREATE POLICY`, `DROP POLICY`, and the `autoEnableRls` guard — reusing it avoids
duplicating complex DDL generation logic in the control-plane handler.

**D2 — Policy mutations go through the DDL-preview + executor flow.**
Rationale: Policy changes are DDL; they must be previewed and explicitly confirmed
the same way as table creation or index changes, so the risk profile and lock-target
information are visible to the admin.

**D3 — Anon/service-role templates as UI presets, not enforced server-side defaults.**
Rationale: The server must accept any valid EARS expression; the console offers the
common presets as convenience templates but does not restrict expressions. This keeps
the API surface general and avoids encoding product-specific role names into the DDL
generation layer.

**D4 — `disableGuard` acknowledgement enforced server-side; console presents the
acknowledgement dialog before submitting.**
Rationale: `validatePostgresGovernanceRequest` already enforces this at the adapter
layer (lines 379-392). The console adds a confirmation dialog for UX; the server is
the authority.

## Risks / Trade-offs

**Risk: An admin enables RLS without creating any policy, leaving the table in
default-deny state and breaking the application.**
Mitigation: The console shows a prominent default-deny warning when
`rlsEnabled: true && policyCount === 0`; the ENABLE RLS action automatically opens
the policy builder in the same flow.

**Risk: A misconfigured `usingExpression` silently denies all rows.**
Mitigation: The SQL preview panel shows the full `CREATE POLICY` statement before
execution; the validator in `ensureSafeExpression` blocks DDL/grant injection.
A dry-run evaluate endpoint (reusing `evaluatePostgresDataApiAccess`) can be added
in a follow-on change.

**Risk: FORCE ROW LEVEL SECURITY blocks the table owner (superuser role) from
bypassing RLS.**
Mitigation: The console labels the `FORCE RLS` toggle clearly and explains that it
applies even to the table owner; the toggle is separate from `ENABLE RLS` and
defaults to off.

## Migration Plan

1. Add `POST /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/policies`
   and `PUT/DELETE .../policies/{policyName}` handlers in
   `apps/control-plane/src/postgres-admin.mjs`, delegating to
   `buildPostgresGovernanceSqlPlan` + executor.
2. Add `PUT/PATCH /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/security`
   write handler (already GET-only) to trigger `table_security` DDL plan.
3. Add the policy-builder form and ENABLE RLS toggle in `ConsolePostgresPage.tsx`
   inside the existing `policies` and `security` tab panels.
4. Surface default-deny warning when `rlsEnabled: true && policyCount === 0`.
5. Run `bash tests/blackbox/run.sh` to confirm no regressions.
6. Run `openspec validate add-console-rls-policies --strict`.
