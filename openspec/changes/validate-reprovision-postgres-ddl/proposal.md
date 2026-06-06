## Why

`services/provisioning-orchestrator/src/appliers/postgres-applier.mjs::_createResource:126-153` constructs DDL from the `domainData` config document. All DDL is dispatched via `query(sql, [])` — the second argument is always `[]`, so nothing is parameterized. DDL identifiers are correctly double-quoted by `_ident` (lines 156-159), but four token categories are interpolated raw:

- **Site 1** — `c.data_type` and `c.column_default` (line 135): `data_type = "text); DROP TABLE x; --"` closes the column definition and injects arbitrary DDL.
- **Site 2** — `item.definition` (view SQL body, line 142): the entire view body is injected verbatim as `CREATE OR REPLACE VIEW … AS ${item.definition}`.
- **Site 3** — `item.privilege_type` (GRANT, line 150): privilege keywords are a closed fixed set; any value outside it (e.g. `SELECT; DROP TABLE x; --`) injects arbitrary SQL.

No validation of any of these fields exists before DDL construction. The blast radius is the tenant's own data source (`credentials.pgClient` is scoped to the tenant). DDL injection within a tenant's own database is a serious integrity risk even without cross-tenant impact (source finding `bug-016`).

## What Changes

- Validate `data_type` against a PostgreSQL type allowlist (base types, constrained length/precision syntax, array suffixes) before interpolation.
- Validate `privilege_type` against the fixed SQL privilege keyword set (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`).
- Validate `column_default` against a safe allowlist (numeric literals, quoted string literals, `true`/`false`, `null`, safe default-expressions like `now()`, `gen_random_uuid()`).
- Treat `item.definition` (view body) as trusted-only; reject any tenant-supplied view SQL definition.
- Reject at validation time in `_processResource` or the `apply` loop before any DDL is constructed — no partial DDL is ever sent to the database.

## Capabilities

### New Capabilities

- `tenant-lifecycle`: DDL injection prevention for PostgreSQL config re-provisioning, ensuring that column types, privilege keywords, column defaults, and view definitions are validated against allowlists before any DDL is constructed or executed.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the tenant-lifecycle capability spec -->

## Impact

- `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs::_createResource:126-153` — fix target (raw interpolation sites for `data_type`, `column_default`, `privilege_type`, `item.definition`)
- `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs::_processResource:70-124` — validation logic inserted here before `_createResource` is called
- `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs::apply:18-68` — entry point; error-accumulation loop at lines 51-63 surfaces validation errors
- Black-box suite: new tests confirming validation errors on non-allowlist types, privileges, and defaults; no DDL executed on invalid configs
