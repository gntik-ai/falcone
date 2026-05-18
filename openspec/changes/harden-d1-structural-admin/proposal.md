## Why

The PostgreSQL structural admin lowercases user-defined type names, issues
multi-step ALTER TABLE without atomicity, accepts unbounded FK cascade
actions, generates colliding NOT NULL constraint names, and ships several
missing-validation gaps around reserved words, CONCURRENTLY indexes, and
forced SECURITY INVOKER. From
`openspec/audit/cap-d1-postgresql-admin-data-api.md`:

- **B-S4.1** (`services/adapters/src/postgresql-structural-admin.mjs:603-611`) —
  `renderDataType` quotes the schema but applies `normalizeIdentifier`
  (which lowercases and strips non-`[a-z0-9_]`) to the type name itself.
  A user-defined type `MyEnum` is rendered as `"public".myenum` — a
  different type than the source code intended.
- **B-S4.2** (`postgresql-structural-admin.mjs:2017-2035`) — multi-step
  ALTER TABLE (TYPE, NOT NULL, DEFAULT) is issued as separate statements
  without intra-statement atomicity; combined with the missing
  transaction wrapper (B-cross.1), partial DDL persists on failure.
- **B-S4.3** (`postgresql-structural-admin.mjs:1874-1875`) — foreign-key
  `onDelete` / `onUpdate` are accepted from the payload without a
  whitelist; the values are rendered via
  `String(...).toUpperCase().replace(/_/g, ' ')`.
- **B-S4.4** (`postgresql-structural-admin.mjs:982`) — auto-generated
  NOT NULL constraint names `<tableName>_<columnName>_not_null` are
  normalised through `normalizeIdentifier` (which truncates to 63
  chars); long names collide deterministically.
- **G-S4.1** — reserved-keyword check is absent: identifier validation
  rejects `pg_*` / `sql_*` but allows `PUBLIC`, `USER`, `CURRENT_USER`
  etc.
- **G-S4.3** (`postgresql-structural-admin.mjs:1254-1255`) —
  `CONCURRENTLY` index option is rejected outright; the DDL plan cannot
  create indexes without blocking writes.
- **G-S4.4** (`postgresql-structural-admin.mjs:1434-1435, 2200`) —
  routines forced to `SECURITY INVOKER` with no path to `SECURITY
  DEFINER` for legitimate use.
- **G-S4.6** (`postgresql-structural-admin.mjs:1874-1875`) — same as
  B-S4.3: FK cascade actions un-whitelisted.

## What Changes

- Render user-defined type names through `quoteIdent`, not
  `normalizeIdentifier`, at
  `postgresql-structural-admin.mjs:603-611`.
- Emit multi-step ALTER TABLE at
  `postgresql-structural-admin.mjs:2017-2035` as a single statement
  with comma-separated `ALTER COLUMN` clauses (PostgreSQL supports
  multi-action ALTER TABLE atomically).
- Whitelist FK `onDelete` / `onUpdate` actions at
  `postgresql-structural-admin.mjs:1874-1875` against
  `{NO ACTION, RESTRICT, CASCADE, SET NULL, SET DEFAULT}`; reject other
  values.
- Hash the auto-generated constraint name when truncation would cause
  collisions at `postgresql-structural-admin.mjs:982`; include a
  short hash suffix to disambiguate.
- Add a reserved-keyword check to identifier validation alongside the
  existing prefix check.
- Permit `CONCURRENTLY` for index creation as an opt-in flag at
  `postgresql-structural-admin.mjs:1254-1255`; document the
  transaction implications.
- Permit `SECURITY DEFINER` as an opt-in routine option at
  `postgresql-structural-admin.mjs:1434-1435, 2200`, gated by a
  `platform_operator` role.

## Capabilities

### Modified Capabilities

- `data-services`: structural admin correctness — case-preserved
  user-defined types, atomic multi-action ALTER TABLE, whitelisted FK
  cascade actions, collision-free constraint names, reserved-keyword
  identifier check, opt-in CONCURRENTLY indexes, and opt-in
  SECURITY DEFINER routines.

## Impact

- Affected code: `services/adapters/src/postgresql-structural-admin.mjs`.
- Migrations: none.
- Breaking changes: callers that today succeed in creating types via
  case-folded names will now need to supply the exact case; callers
  passing unrecognised FK cascade actions will receive 400. Callers
  that depend on multi-statement ALTER TABLE will see the new
  multi-action ALTER TABLE syntax.
- Out of scope: data-API quota and bulk concerns
  (`harden-d1-data-api-quotas-and-bulk`); governance bugs
  (`fix-d1-governance-policy-correctness`); effective-roles trust
  (`harden-d1-effective-roles-trust`); cross-cutting policy adoption
  (`harden-d1-authorization-policy-adoption`).
