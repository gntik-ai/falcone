# Capability D1 — PostgreSQL Admin & Data API (adapters)

**Source locus** (≈7300 LOC of `.mjs` + 18 LOC shared authorization-policy):

| File | LOC |
|---|---|
| `services/adapters/src/postgresql-admin.mjs` | 2318 |
| `services/adapters/src/postgresql-structural-admin.mjs` | 2228 |
| `services/adapters/src/postgresql-data-api.mjs` | 1996 |
| `services/adapters/src/postgresql-governance-admin.mjs` | 717 |
| `services/adapters/src/authorization-policy.mjs` | 18 |

**Method.** Read `authorization-policy.mjs` myself (18 LOC), surveyed test inventory (11 test files), delegated four Explore agents — one per large adapter file — to extract behaviors, gaps, and bugs. After the agents returned, I directly spot-verified five of the most damaging claims by reading the exact cited line ranges. Marked findings below as **Verified-by-author** where I re-grounded the claim against source, **Subagent-reported** where I am relaying the agent's analysis without re-grounding.

Up-front structural notes:

- The adapters are pure compilers — they emit SQL plans, validation results, and audit metadata, but they do not execute SQL. Execution is the caller's responsibility. Several of the "BUGS" below are therefore about *what the SQL plan promises* vs. *what the calling layer will actually do*.
- The two consumers in `apps/control-plane/src/{postgres-admin,postgres-data-api}.mjs` are thin façades over these adapters and were sampled but not deeply reviewed.
- `authorization-policy.mjs` is purely a re-export of three contract objects (`adapterEnforcementSurfaces`, `adapterContextTargets`, `workspaceOwnedResourceSemantics`) read from `services/internal-contracts/`. The adapters do not call `authorization-policy.mjs` at all — they implement their own role/scope checks (admin SQL) or rely entirely on `evaluatePostgresDataApiAccess` (data API) which lives in `postgresql-governance-admin.mjs`. Cross-cutting policy enforcement is therefore split across three files with no shared dispatcher.

---

## SPEC (what exists)

### S1. Identifier escaping and SQL primitives (shared idiom)

- **WHEN** rendering any object name into SQL, **THE SYSTEM SHALL** quote with double quotes via `quoteIdent(value) = `"${String(value).replace(/"/g, '""')}"`` (`postgresql-governance-admin.mjs:70-72`; `postgresql-admin.mjs:346`; `postgresql-structural-admin.mjs:599-601`; `postgresql-data-api.mjs:114`).
- **WHEN** rendering string literals into SQL, **THE SYSTEM SHALL** use `quoteLiteral` which wraps a single-quoted string and escapes embedded `'` as `''` (`postgresql-governance-admin.mjs:74-76`; `postgresql-admin.mjs:350`; `postgresql-data-api.mjs:118`).
- **WHEN** binding values, **THE SYSTEM SHALL** push placeholders `$N` via `pushValue(values, v, cast?)`; data-API additionally appends `::cast` for typed casts (`postgresql-data-api.mjs:126`).

### S2. PostgreSQL Admin (`postgresql-admin.mjs`)

- **WHEN** `resolvePostgresAdminSqlPolicy(plan, originSurface, actorType, scopes, effectiveRoles)` is called, **THE SYSTEM SHALL** return `{enabled, auditRequired, allowedOrigins, allowedRoles}` derived from the plan and surface (`postgresql-admin.mjs:801-819`).
- **WHEN** `validatePostgresAdminSqlRequest(payload, plan, scopes, effectiveRoles, originSurface)` runs, **THE SYSTEM SHALL** reject unless `originSurface ∈ {web_console, control_api}`, `actorType ∈ {human_operator, platform_operator}`, scopes include `database.admin`, and at least one effective role is in `{workspace_owner, workspace_admin, workspace_operator, platform_operator, platform_team}` (`postgresql-admin.mjs:848-864`).
- **WHEN** admin SQL is validated, **THE SYSTEM SHALL** enforce single-statement-per-request, reject transaction control (BEGIN/COMMIT/ROLLBACK), and forbid `ALTER SYSTEM`, `COPY PROGRAM`, `SET ROLE` (`postgresql-admin.mjs:877-888`).
- **WHEN** plan `pln_01starter` or `pln_01growth` is selected, **THE SYSTEM SHALL** disable admin SQL (`postgresql-admin.mjs:142-147`).
- **WHEN** plan `pln_01regulated` or `pln_01enterprise` is selected, **THE SYSTEM SHALL** enable admin SQL and require audit (`postgresql-admin.mjs:145-147`).
- **WHEN** `buildPostgresAdminSqlAdapterCall(payload, …)` is called, **THE SYSTEM SHALL** compile named parameters `:name` to positional `$N`, compute a statement fingerprint, and return an adapter call object (`postgresql-admin.mjs:1018-1130`).
- **WHEN** `buildPostgresAdminAdapterCall(payload, action, resourceKind, context)` is called for one of role/user/database/schema/table/index/view/function, **THE SYSTEM SHALL** validate, normalize, build a DDL plan, generate SQL statements, and compute pre-execution warnings (`postgresql-admin.mjs:1817-1920`).
- **WHEN** quota guardrails are evaluated, **THE SYSTEM SHALL** look up `plan → quotaGuardrails`; missing planId falls back to `pln_01growth`/`pln_01regulated` defaults (`postgresql-admin.mjs:407-416`).
- **WHEN** building inventory snapshots, **THE SYSTEM SHALL** compute quota status, refcounts by database, and return a normalized snapshot (`postgresql-admin.mjs:1922-2236`).
- **WHEN** building audit metadata, **THE SYSTEM SHALL** include statement fingerprint, risk level, and isolation boundary (`postgresql-admin.mjs:2238-2316`).

### S3. PostgreSQL Data API (`postgresql-data-api.mjs`)

- **WHEN** `list` is invoked, **THE SYSTEM SHALL** generate a parameterized SELECT with optional joins, RLS clause (OR of policy fragments), filter expressions, ordering (whitelisted asc/desc), and keyset cursor pagination (`postgresql-data-api.mjs:1793-1850`, `:586-610`, `:690-732`).
- **WHEN** `get` is invoked, **THE SYSTEM SHALL** issue a single-row SELECT by primary key with RLS enforcement (`postgresql-data-api.mjs:1851-1864`).
- **WHEN** `insert`, `update`, or `delete` is invoked, **THE SYSTEM SHALL** issue the corresponding statement with RLS check on new/existing row and return requested columns (`:1862`-…).
- **WHEN** `bulk_insert` / `bulk_update` / `bulk_delete` is invoked, **THE SYSTEM SHALL** validate row count is 1–500, evaluate `resolveEffectiveRoleForBatch` once, and execute as a CTE-joined batch (`postgresql-data-api.mjs:1108-1138, 1227-1300`).
- **WHEN** `rpc` is invoked, **THE SYSTEM SHALL** require schema-plus-EXECUTE grant only and execute the routine without RLS enforcement (`postgresql-data-api.mjs:1146-1191`).
- **WHEN** `import` (CSV/JSON) is invoked, **THE SYSTEM SHALL** delegate JSON to `bulk_insert` and CSV to a `COPY FROM STDIN` plan with `DELIMITER ${quoteLiteral(delimiter ?? ',')}` (`postgresql-data-api.mjs:1417-1482`).
- **WHEN** `export` is invoked, **THE SYSTEM SHALL** wrap a SELECT in `COPY (…) TO STDOUT` (JSON/CSV) honoring RLS/filters/joins (`postgresql-data-api.mjs:1505-1551`).
- **WHEN** `saved_query` or `stable_endpoint` is created/invoked, **THE SYSTEM SHALL** treat the source as table/view/routine and require slug+method+auth-mode metadata (`postgresql-data-api.mjs:1597-1745`).
- **WHEN** filter operators are parsed, **THE SYSTEM SHALL** accept `eq, neq, gt, gte, lt, lte, in, between, like, ilike, is{null|not_null}, json_contains, json_path_eq` (`postgresql-data-api.mjs:26-40, 620-688`).
- **WHEN** RLS is enabled and at least one policy applies to the actor, **THE SYSTEM SHALL** emit a tenant matcher `${alias}."tenantId" = $N` per policy or `FALSE` for `deny_all` (`postgresql-data-api.mjs:595-611`).
- **WHEN** cursor pagination is requested, **THE SYSTEM SHALL** serialize/deserialize cursors as base64url-encoded JSON (`postgresql-data-api.mjs:701-732`).

### S4. PostgreSQL Structural Admin (`postgresql-structural-admin.mjs`)

- **WHEN** `validatePostgresStructuralRequest` runs, **THE SYSTEM SHALL** return `{violations, normalized, typeCatalog}` for resource kinds `{table, column, type, constraint, index, view, materialized_view, function, procedure}` (`postgresql-structural-admin.mjs:1652`).
- **WHEN** identifier normalisation runs, **THE SYSTEM SHALL** lowercase, strip to `[a-z][a-z0-9_]{0,62}`, and reject `pg_*`/`sql_*` prefixes (`postgresql-structural-admin.mjs:279-…`).
- **WHEN** a default expression is supplied, **THE SYSTEM SHALL** accept only literals, casted literals, or whitelisted functions (`now()`, `uuid_generate_v4()`, etc.) via `isSafeDefaultExpression` (`postgresql-structural-admin.mjs:536-…`).
- **WHEN** a CHECK expression is supplied, **THE SYSTEM SHALL** validate against `isSafeCheckExpression` rejecting semicolons/comments (`postgresql-structural-admin.mjs:553-…`).
- **WHEN** a view query is supplied, **THE SYSTEM SHALL** require `SELECT`/`WITH` prefix and forbid 13 mutating tokens (`postgresql-structural-admin.mjs:567-…`).
- **WHEN** a routine body is supplied, **THE SYSTEM SHALL** reject `SECURITY DEFINER`, `ALTER SYSTEM`, `COPY`, role/extension operations, file I/O, `dblink` (`postgresql-structural-admin.mjs:581-596`).
- **WHEN** a column type change is requested, **THE SYSTEM SHALL** allow only the three widening transitions `int→bigint`, `smallint→int`, `smallint→bigint` (`postgresql-structural-admin.mjs:722-756`).
- **WHEN** a create action targets `{tables, columns, constraints, indexes, views, materialized_views, functions, procedures}`, **THE SYSTEM SHALL** check `wouldExceedQuota` against `profile.quotaGuardrails` (`postgresql-structural-admin.mjs:792, :1705-1748`).
- **WHEN** a view's query references other relations, **THE SYSTEM SHALL** extract dependencies via a `from|join` regex and reject unknown relations against `context.availableRelations` (`postgresql-structural-admin.mjs:702-716, :1338-1348`).
- **WHEN** building a structural SQL plan, **THE SYSTEM SHALL** return a transaction-marker plan; the caller is responsible for executing inside a transaction (`postgresql-structural-admin.mjs:1939`).
- **WHEN** rendering routines, **THE SYSTEM SHALL** hard-code `SECURITY INVOKER` (`postgresql-structural-admin.mjs:1434-1435, 2200`).

### S5. PostgreSQL Governance Admin (`postgresql-governance-admin.mjs`)

- **WHEN** `validatePostgresGovernanceRequest` runs for `{table_security, policy, grant, extension, template}`, **THE SYSTEM SHALL** check required fields and return a violations array (`postgresql-governance-admin.mjs:360-511`).
- **WHEN** a `grant` resource is validated, **THE SYSTEM SHALL** reject `granteeRoleName` that starts with `pg_` or normalises to `postgres` (`postgresql-governance-admin.mjs:437-439`).
- **WHEN** a `policy` resource is validated, **THE SYSTEM SHALL** parse `usingExpression`/`withCheckExpression` against an SQL-injection pattern (`postgresql-governance-admin.mjs:420-421, 183-188`).
- **WHEN** an `extension` is validated, **THE SYSTEM SHALL** require it to be in the merged catalog (`postgresql-governance-admin.mjs:482-487, 138-169`).
- **WHEN** an RLS policy is rendered, **THE SYSTEM SHALL** emit `CREATE POLICY <name> ON <schema>.<table>[ AS RESTRICTIVE][ FOR <command>][ TO <roles>][ USING (…)][ WITH CHECK (…)]` (`postgresql-governance-admin.mjs:191-200`).
- **WHEN** a grant is rendered, **THE SYSTEM SHALL** emit `GRANT|REVOKE <privs> ON <target> TO|FROM <role>[ WITH GRANT OPTION]` (`postgresql-governance-admin.mjs:212-231`).
- **WHEN** `evaluatePostgresDataApiAccess(policies, sessionContext, action, row?)` is invoked, **THE SYSTEM SHALL** return a reason in `{missing_grant, grant_only, no_applicable_rls_policy, grant_and_rls_allow, rls_filtered}` based on grant presence + RLS evaluation (`postgresql-governance-admin.mjs:656-709`).
- **WHEN** a `session_equals_row` matcher is invoked, **THE SYSTEM SHALL** push `sessionContext[matcher.sessionKey ?? 'tenantId']` as a placeholder and compare against the row column (`postgresql-data-api.mjs:602-604`; matcher kinds catalogued in `postgresql-governance-admin.mjs:646-654`).
- **WHEN** generating a lock target for governance mutations, **THE SYSTEM SHALL** key by `${databaseName}.${schemaName}.${tableName}.security|.policy.${policyName}|.objectType.${objectName}.${granteeRoleName}` (`postgresql-governance-admin.mjs:551, 568, 580, 606, 610`).

### S6. Shared authorization-policy contract (`authorization-policy.mjs`)

- **WHEN** `authorization-policy.mjs` is imported, **THE SYSTEM SHALL** expose `adapterEnforcementSurfaces` (filtered to `{data_api, functions_runtime, event_bus, object_storage}`), `adapterContextTargets` (filtered to `{adapter_call, kafka_headers, openwhisk_activation, storage_presign_context}`), and `workspaceOwnedResourceSemantics` (filtered to `parent_scope = 'workspace'`) (`authorization-policy.mjs:1-19`).

---

## GAPS

### G-cross. Cross-cutting

1. **Authorization-policy.mjs is referenced by no adapter file.** A `grep` from inside `services/adapters/src/` shows no imports of `./authorization-policy.mjs` from any of the four PostgreSQL adapters. Each adapter implements its own scope/role check (admin SQL) or delegates to `evaluatePostgresDataApiAccess` (data API). The "shared authorization contract" file is purely consumed by other services; the PostgreSQL adapters do not honour it.
2. **All four adapters are pure compilers; execution is delegated.** No file in this set opens a `pg` connection or runs a query. The "transactional vs non-transactional DDL" markers in the structural and admin files set expectations the caller must honour (see B-cross.1).
3. **Tests exist but cover compilation only.** The 11 test files under `tests/adapters/`, `tests/unit/`, `tests/resilience/`, `tests/contracts/`, `tests/e2e/console/` exercise the SQL-string output (and validation) but cannot reach execution-time concerns (transaction atomicity, lock semantics, partial-failure recovery).

### G-S2. Admin

- **G-S2.1** `buildPostgresAdminAdapterCall` does *not* re-check scopes/effectiveRoles — it only calls `validatePostgresAdminRequest`, which validates resource/action structure and quotas (`postgresql-admin.mjs:1817-1844`, `:1422-1657`, subagent-reported, **verified-by-author** by grep). Authorization is therefore split: the SQL-execution path (`buildPostgresAdminSqlAdapterCall`) checks scopes; the DDL-mutation path does not. Callers must enforce upstream.
- **G-S2.2** Quota-guardrails fallback to `pln_01growth`/`pln_01regulated` silently when `planId` is unknown (`postgresql-admin.mjs:407-416`, subagent-reported). Spoofed plan ids quietly downgrade.
- **G-S2.3** Placement-mode value `'unknown'` only emits a warning, not a violation (`postgresql-admin.mjs:1440-1442`, subagent-reported). Downstream isolation depends on placement mode.
- **G-S2.4** Inventory functions assume bounded inputs (`postgresql-admin.mjs:2064-2080, 2206-2224`).
- **G-S2.5** Workspace role prefix check uses a generic `hasPrefix` that allows `prefix=''` to match anything (`postgresql-admin.mjs:1475-1477`, subagent-reported).
- **G-S2.6** `splitSqlStatements` swallows exception types into a free-text violation string (`postgresql-admin.mjs:873-875`).

### G-S3. Data API

- **G-S3.1** `rpc` operations explicitly bypass RLS (`rlsEnforced: false`) (`postgresql-data-api.mjs:1190-1191`, subagent-reported). A workspace_admin invoking a function can read whatever the function returns regardless of policies.
- **G-S3.2** Default RLS matcher is hard-coded to `{kind: 'session_equals_row', sessionKey: 'tenantId', columnName: 'tenantId'}` (`postgresql-data-api.mjs:596`, **verified-by-author**). No code path validates `sessionContext.tenantId` is present before pushing the placeholder.
- **G-S3.3** Bulk operations evaluate the role once for the batch; if all rows can pass through the same role's grant, RLS is applied uniformly using whichever sessionContext was provided. There is no per-row tenant isolation check (`postgresql-data-api.mjs:1108-1138`, subagent-reported).
- **G-S3.4** Cursor serialization is base64url-encoded JSON, decoded without try/catch (`postgresql-data-api.mjs:701-708`, subagent-reported).
- **G-S3.5** `in` filter cap absent (`postgresql-data-api.mjs:657-662`); a 1M-element array becomes a 1M-placeholder list.
- **G-S3.6** Join-target RLS evaluation reuses `evaluatePlanningAccess` but with the joined table's policies — if those are empty, the join is allowed (`postgresql-data-api.mjs:750-762`, subagent-reported).
- **G-S3.7** `import.csv` accepts user-supplied delimiter into `COPY ... DELIMITER ${quoteLiteral(...)}` (`postgresql-data-api.mjs:1482`, subagent-reported). `quoteLiteral` does escape single quotes but does not constrain to single-character delimiters.
- **G-S3.8** No row limit on `export` COPY-TO-STDOUT (`postgresql-data-api.mjs:1550-1551`).

### G-S4. Structural

- **G-S4.1** Reserved-keyword check is absent. Identifier validation rejects `pg_*`/`sql_*` prefixes (`postgresql-structural-admin.mjs:279-…`) but does not reject SQL keywords (`PUBLIC`, `USER`, `CURRENT_USER`, …), which when quoted are technically usable but trigger downstream tooling bugs.
- **G-S4.2** Multi-step ALTER TABLE (TYPE, NOT NULL, DEFAULT) issued as separate statements without intra-statement atomicity (`postgresql-structural-admin.mjs:2017-2035`, subagent-reported).
- **G-S4.3** `CONCURRENTLY` index option is rejected outright (`postgresql-structural-admin.mjs:1254-1255`, subagent-reported). The DDL plan cannot create indexes without blocking writes.
- **G-S4.4** Routines are forced to `SECURITY INVOKER` (`postgresql-structural-admin.mjs:1434-1435, 2200`, subagent-reported). No path to `SECURITY DEFINER` even for legitimate use.
- **G-S4.5** `routineBody` validation differs between SQL functions (require `SELECT`/`WITH`) and SQL procedures (no such requirement) (`postgresql-structural-admin.mjs:567-…, :581-596`, subagent-reported). Inconsistent.
- **G-S4.6** Foreign-key `onDelete`/`onUpdate` accepted from payload without whitelist; rendered via `String(...).toUpperCase().replace(/_/g, ' ')` (`postgresql-structural-admin.mjs:1874-1875`, subagent-reported).
- **G-S4.7** No test references found in the inspected file; depends on downstream integration tests.

### G-S5. Governance

- **G-S5.1** Policy roles bypass the `pg_*`/`postgres` check applied to grants (`postgresql-governance-admin.mjs:121-124, 195`, **verified-by-author**). See B-S5.2.
- **G-S5.2** No audit/log emission of mutations. `ownershipForContext` captures `managedBy` but no row is written anywhere in this file (subagent-reported).
- **G-S5.3** `safeIdentifier` is defined (`:64-68`) but never called. Dead code (**verified-by-author**, see B-S5.1).
- **G-S5.4** Grant update path issues `REVOKE` with `normalized.privileges`; if the array is empty, line 219 (subagent-reported) falls back to `REVOKE ALL PRIVILEGES` — a cascading mass-revoke instead of a no-op.
- **G-S5.5** No catalog cross-check: roles never verified against `pg_roles`, extensions never against `pg_extension`, tables never against `information_schema.tables`.
- **G-S5.6** Default privileges for future objects (`ALTER DEFAULT PRIVILEGES`) not generated by schema creation; new tables inherit cluster defaults.
- **G-S5.7** Lock target for schema-level grants omits the object name (`postgresql-governance-admin.mjs:580`, subagent-reported) — two concurrent grants on the same schema to different roles collide.

---

## BUGS

### B-cross. Cross-cutting

- **B-cross.1 Likely — Plan markers say "transactional DDL" but the adapters provide no transaction wrapper.**
  `postgresql-admin.mjs:1747` (`transactionMode: 'non_transactional_ddl'`) and `:1790` (`transactionMode: 'transactional_ddl'`) are advisory strings. The structural file similarly returns a "transaction plan" (`postgresql-structural-admin.mjs:1939`) but emits an array of statements. Callers must implement `BEGIN; … COMMIT;` themselves. If a caller executes statement-by-statement and a mid-sequence statement fails, prior DDL persists. The adapters do not communicate failure handling intent. (Subagent-reported across admin, structural; behaviour confirmed by reading the cited markers.)

- **B-cross.2 Confirmed — Adapters do not import `authorization-policy.mjs`.**
  No adapter calls `adapterEnforcementSurfaces`, `adapterContextTargets`, or `workspaceOwnedResourceSemantics`. The shared contract module is exported but unused by the very adapters the capability map says it governs (**verified-by-author** by grep).

### B-S2. Admin

- **B-S2.1 Confirmed — `effectiveRoles` is trusted from the request payload.** `postgresql-admin.mjs:862-864` performs `effectiveRoles.some(role => allowed.has(role))` with no proof that the caller actually holds the role. If the upstream API layer ever passes the caller's *requested* (rather than *evaluated*) roles, the adapter authorises any caller who lists `workspace_owner` in their token. (Subagent-reported; the code does indeed check membership in an allow-list, not authentication.)
- **B-S2.2 Likely — Quota-guardrail fallback silently downgrades on bad planId.** `postgresql-admin.mjs:407-416` (subagent-reported).
- **B-S2.3 Likely — Placement-mode `'unknown'` proceeds with a warning, not a block.** `postgresql-admin.mjs:1440-1442` (subagent-reported).
- **B-S2.4 Needs verification — Named-parameter regex with PostgreSQL `::cast` operator.** `postgresql-admin.mjs:779` uses `/(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g`. **Verified-by-author**: the negative lookbehind correctly skips the second colon of `::cast`, so `SELECT 'x'::uuid` is *not* misinterpreted — the subagent's claim of fragility is real (the code is hard to reason about) but the runtime behaviour is correct. Downgrade from "confirmed" to "needs verification": still worth a comment, not a bug.
- **B-S2.5 Likely — Workspace role prefix check defaults to empty prefix.** `postgresql-admin.mjs:1475-1477` (subagent-reported). If `workspaceNamePrefix` is falsy, the prefix check allows any role name.
- **B-S2.6 Needs verification — `splitSqlStatements` quote-escape detection assumes backslash escapes.** `postgresql-admin.mjs:710, 716` (subagent-reported). PostgreSQL standard-conforming strings use `''` rather than `\'`. Confirm whether the parser is meant to support both dialects or only the standard.

### B-S3. Data API

- **B-S3.1 Confirmed — Missing session-context key produces a silent deny-all.**
  `postgresql-data-api.mjs:602-604` — `pushValue(values, sessionContext?.[matcher.sessionKey ?? 'tenantId'])`. If the key is absent, `pushValue` receives `undefined`, which `node-pg` converts to `NULL`. The emitted predicate `${alias}."tenantId" = $N` then evaluates to `NULL` ≡ `UNKNOWN` for every row, which the WHERE filter treats as false — every query returns zero rows with no error. **Verified-by-author**: lines 595-611 confirm there is no guard before `pushValue`. This is the most damaging single bug in this capability.
- **B-S3.2 Likely — Cross-tenant bulk operations against a tenant-blind role.**
  `postgresql-data-api.mjs:1108-1138, 1281-1300` — bulk insert/update/delete evaluate the role once for the batch. If the role has a grant and no RLS forces per-row tenant equality, the batch can carry rows belonging to multiple tenants. (Subagent-reported, plausible from the cited code.)
- **B-S3.3 Likely — Cursor parse failure is uncaught.**
  `postgresql-data-api.mjs:707` — `JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))`. Malformed cursor → uncaught `SyntaxError`. DoS-trivial for any endpoint exposing the cursor. (Subagent-reported.)
- **B-S3.4 Likely — RPC bypasses RLS.**
  `postgresql-data-api.mjs:1190-1191`. By design per the markers, but easy to abuse: a function that selects `from sensitive_table` returns rows the caller could not read directly. (Subagent-reported.)
- **B-S3.5 Likely — `in` filter unbounded.**
  `postgresql-data-api.mjs:657-662` (subagent-reported).
- **B-S3.6 Needs verification — `pushValue(values, undefined, 'text')` for JSON path segments.**
  `postgresql-data-api.mjs:680-682`. Parameterising path segments as `text` is the safe pattern. Verify that `jsonb_extract_path_text` evaluates parameterised path elements as data, not as expressions — likely safe but non-obvious.
- **B-S3.7 Needs verification — Session-setting injection via `buildTraceSettings`.**
  `postgresql-data-api.mjs:909-918` (subagent-reported). If `trace.actorId` is interpolated into a `SET` command without parameterisation, an unfiltered actor id can inject SQL. Confirm with execution code (out of this file).

### B-S4. Structural

- **B-S4.1 Confirmed — User-defined type names are silently lowercased.**
  `postgresql-structural-admin.mjs:603-611` — `renderDataType` emits `${quoteIdent(schema)}.${normalizeIdentifier(typeName)}`. **Verified-by-author**: line 607-608 quotes the schema but applies `normalizeIdentifier` (which lowercases and strips non-`[a-z0-9_]`) to the type name itself. A user-defined type called `MyEnum` is rendered as `"public".myenum`, which is a different type than the source code intended (or fails entirely if `MyEnum` exists case-sensitively).
- **B-S4.2 Likely — Multi-step ALTER TABLE leaves partial state on failure.**
  `postgresql-structural-admin.mjs:2017-2035` (subagent-reported). Combined with B-cross.1, the caller has no rollback signal.
- **B-S4.3 Likely — Foreign-key cascade action accepted without whitelist.**
  `postgresql-structural-admin.mjs:1874-1875` (subagent-reported).
- **B-S4.4 Likely — Auto-generated NOT NULL constraint names can collide.**
  `postgresql-structural-admin.mjs:982` (subagent-reported). `<tableName>_<columnName>_not_null` normalised through `normalizeIdentifier` (which truncates to 63 chars) can collide for long names.
- **B-S4.5 Needs verification — View dependency regex is greedy.**
  `postgresql-structural-admin.mjs:702-716` (subagent-reported). `from|join` regex matches string-literal contents (e.g., `SELECT 'from fake_table' AS col FROM real_table`). Mitigated by `availableRelations` lookup, but `fake_table` pollutes the dependency list.

### B-S5. Governance

- **B-S5.1 Confirmed — `safeIdentifier` reserved-prefix check is dead code.**
  `postgresql-governance-admin.mjs:64-68` — the ternary is literally `return X ? normalized : normalized;`. **Verified-by-author**: both branches return the same value, so the `IDENTIFIER_PATTERN` test and the `RESERVED_PREFIX_PATTERN` test have no effect. The function returns `normalized` unconditionally (only the early-return on falsy `normalized` actually does anything). Combined with B-S5.4 (`safeIdentifier` is never called), this is "dead code that would still be wrong if it were called".
- **B-S5.2 Confirmed — Policy roles bypass the reserved-role check applied to grants.**
  `postgresql-governance-admin.mjs:121-124` — `normalizePolicyRoles` only does `.trim()` with no `pg_*`/`postgres` check. **Verified-by-author**: line 195 quotes the result straight into `CREATE POLICY … TO "<role>"`. By contrast, line 437-439 explicitly rejects `pg_*` for grants. Asymmetric defence: a caller can attach a policy to `pg_signal_backend` even though they cannot grant to it.
- **B-S5.3 Likely — REVOKE with empty privileges falls back to `REVOKE ALL PRIVILEGES`.**
  `postgresql-governance-admin.mjs:213, 219` (subagent-reported). An update that clears `normalized.privileges` to `[]` emits `REVOKE ALL PRIVILEGES`, cascading away grants not tracked by this resource.
- **B-S5.4 Likely — `safeIdentifier` declared but never called.**
  `postgresql-governance-admin.mjs:64-68` (**verified-by-author** combined with B-S5.1).
- **B-S5.5 Needs verification — RLS enabled without an applicable policy denies all queries.**
  `postgresql-governance-admin.mjs:694-701` (subagent-reported). PostgreSQL's RLS default-deny is the upstream cause; the adapter does not warn the operator who toggles `enableRls` without creating a `FOR all` policy.
- **B-S5.6 Likely — Schema-grant lock target collides across roles.**
  `postgresql-governance-admin.mjs:580` (subagent-reported). `${db}.${schema}.${granteeRoleName}` with missing object name is identical across roles when objectName is undefined.
- **B-S5.7 Needs verification — `policyAppliesToActor` uses string-includes on a role array.**
  `postgresql-governance-admin.mjs:643` (subagent-reported). Quoted vs unquoted normalisation differs.

---

## Scope note for downstream spec authoring

D1 is one of the larger capabilities and most defensively coded — extensive quote functions, allow-list validators, and dependency tracking are in place. But there are two systemic weaknesses that any spec proposal should address before formalising FRs:

1. **The adapters are compilers; transactionality is the caller's problem.** Every "non-atomic ALTER" / "partial DDL on failure" bug in this audit (B-cross.1, B-S4.2, B-S5.3 cascade) stems from the same root cause: the adapters return a list of statements with an advisory `transactionMode` field. There is no shared executor that turns the plan into one transaction. Either (a) write a thin executor in this package that consumes the plan and runs it under `BEGIN`/`COMMIT` (preferred), or (b) move the transaction-wrapping policy into a shared contract validated by tests.
2. **The shared `authorization-policy.mjs` is unused.** The data-API enforcement path lives entirely inside `postgresql-governance-admin.mjs::evaluatePostgresDataApiAccess`, which is itself called from the data-API adapter. The admin-SQL enforcement path is hand-rolled inside `postgresql-admin.mjs`. There is no single source of truth for which scopes/roles can do what. A future "authorization model" capability spec should subsume this.

**Highest-impact bugs to fix before specs are written:**

- **B-S3.1** Silent deny-all on missing `sessionContext[sessionKey]` (data-API). Behaviour is invisible — looks like an empty table to clients, looks like authorised in the audit log.
- **B-S5.1** `safeIdentifier` dead-code ternary. Easy fix (return `undefined` on mismatch); risk is small if the function is unused, but B-S5.4 suggests it was *meant* to be used.
- **B-S5.2** Policy roles bypass reserved-role check. Trivial to exploit if a caller can submit a `CREATE POLICY` mutation.
- **B-S4.1** User-defined type names silently lowercased. Either fix `renderDataType` to use `quoteIdent` for user-defined types, or document that the structural admin only supports lowercase type names.
- **B-S2.1** Trust of caller-supplied `effectiveRoles`. The whole admin-SQL policy depends on it.
