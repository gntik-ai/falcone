## Why

The PostgreSQL governance admin has four concrete correctness bugs that turn
intended safeguards into no-ops and turn a no-op revoke into a cascading
mass-revoke. From `openspec/audit/cap-d1-postgresql-admin-data-api.md`:

- **B-S5.1** (`services/adapters/src/postgresql-governance-admin.mjs:64-68`) —
  `safeIdentifier` is `return X ? normalized : normalized` — both branches
  of the ternary return the same value, so the `IDENTIFIER_PATTERN` test
  and the `RESERVED_PREFIX_PATTERN` test are dead code.
- **B-S5.2** (`postgresql-governance-admin.mjs:121-124`) —
  `normalizePolicyRoles` only does `.trim()` with no `pg_*` / `postgres`
  check; line 195 quotes the result straight into
  `CREATE POLICY … TO "<role>"`. The grant path at `:437-439` explicitly
  rejects `pg_*` for grants — asymmetric defence lets a caller attach a
  policy to `pg_signal_backend` even though they cannot grant to it.
- **B-S5.3** (`postgresql-governance-admin.mjs:213, 219`) — a grant update
  that clears `normalized.privileges` to `[]` falls back to
  `REVOKE ALL PRIVILEGES`, cascading away grants not tracked by this
  resource. The intended behaviour is a no-op.
- **B-S5.4** (`postgresql-governance-admin.mjs:64-68`) — `safeIdentifier`
  is declared but never called anywhere in the file (`grep` confirms
  no callers), so even when the dead-code ternary is fixed the function
  must be wired in to the validation paths it was intended to guard.

## What Changes

- Rewrite `safeIdentifier` at
  `postgresql-governance-admin.mjs:64-68` so the ternary actually
  branches: return `undefined` (or raise) when the identifier matches
  the reserved prefix; return the normalised identifier otherwise.
- Call `safeIdentifier` from every identifier-quoting site in the file
  (policy name, table name, schema name, role name) so the validation
  is no longer dead code.
- Apply the `pg_*` / `postgres` reserved-role check to
  `normalizePolicyRoles` at
  `postgresql-governance-admin.mjs:121-124`, matching the grant-path
  check at `:437-439`. A caller MUST NOT attach a policy to a reserved
  role.
- Change the `REVOKE` path at
  `postgresql-governance-admin.mjs:213, 219` so an empty
  `normalized.privileges` array is treated as a no-op (or rejected with
  a validation error). It MUST NOT fall back to
  `REVOKE ALL PRIVILEGES`.

## Capabilities

### Modified Capabilities

- `data-services`: governance admin policy / grant correctness — reserved-role
  symmetry across policies and grants, live identifier validation, and a
  no-op (not cascading) empty-privileges REVOKE.

## Impact

- Affected code:
  `services/adapters/src/postgresql-governance-admin.mjs`.
- Migrations: none.
- Breaking changes: callers that today create policies attached to `pg_*`
  roles will now be rejected; callers that today issue a REVOKE with an
  empty privileges array (relying on the cascading mass-revoke) will now
  be no-ops or 400 errors.
- Out of scope: cross-cutting `authorization-policy.mjs` adoption
  (`harden-d1-authorization-policy-adoption`); structural admin bugs
  (`harden-d1-structural-admin`).
