## Why

The PostgreSQL Data API ships several execution-path safety gaps that make
bulk operations cross-tenant by design, allow DoS via cursor parse, and
permit unbounded `in` lists / `COPY TO STDOUT` rows / RPC bypasses of RLS.
From `openspec/audit/cap-d1-postgresql-admin-data-api.md`:

- **B-S3.2** (`services/adapters/src/postgresql-data-api.mjs:1108-1138`) —
  bulk insert/update/delete evaluates `resolveEffectiveRoleForBatch` once
  per batch. If the role has a grant and no RLS forces per-row tenant
  equality, the batch carries rows belonging to multiple tenants.
- **B-S3.3** (`postgresql-data-api.mjs:707`) —
  `JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))`
  has no try/catch; a malformed cursor raises an uncaught `SyntaxError`,
  trivially DoS-able.
- **B-S3.4** (`postgresql-data-api.mjs:1190-1191`) — `rpc` operations
  explicitly set `rlsEnforced: false`. A workspace_admin invoking a
  function reads whatever the function returns regardless of policies.
- **B-S3.5** (`postgresql-data-api.mjs:657-662`) — the `in` filter is
  unbounded; a 1M-element array becomes a 1M-placeholder list.
- **G-S3.6** (`postgresql-data-api.mjs:750-762`) — join-target RLS
  evaluation reuses `evaluatePlanningAccess` but with the joined table's
  policies; if those policies are empty, the join is allowed.
- **G-S3.7** (`postgresql-data-api.mjs:1482`) — `import.csv` accepts a
  user-supplied delimiter into `COPY ... DELIMITER ${quoteLiteral(...)}`;
  `quoteLiteral` escapes single quotes but does not constrain to single
  characters.
- **G-S3.8** (`postgresql-data-api.mjs:1550-1551`) — no row limit on
  `export` COPY-TO-STDOUT; one query can dump the full table.

## What Changes

- Enforce a per-row tenant-equality predicate in the bulk SQL plan at
  `postgresql-data-api.mjs:1108-1138`: every row's tenant column MUST
  equal the resolved `sessionContext.tenantId`, regardless of role grant.
- Wrap cursor decoding at `:701-708` in a try/catch and return HTTP 400
  `INVALID_CURSOR` on parse failure.
- Add an explicit `requireRls` opt-in to the `rpc` action; the default
  MUST run with RLS-equivalent enforcement (a session-bound parameter
  that the routine reads), and RLS bypass MUST be a documented opt-in
  with a 'platform_operator' role gate.
- Cap `in` filter array length to a configurable limit (default 1000) at
  `:657-662`; reject larger inputs with HTTP 400.
- Validate join-target RLS at `:750-762`: if a joined relation has no
  applicable policy for the actor, raise `RlsJoinTargetUngovernedError`
  rather than emitting an unrestricted join.
- Validate the CSV delimiter at `:1482` against a single-character
  allow-list (`,`, `;`, `\t`, `|`).
- Add a configurable row limit on `export` COPY-TO-STDOUT at
  `:1550-1551`; default 1,000,000 rows.

## Capabilities

### Modified Capabilities

- `data-services`: per-row tenant equality on bulk operations, safe
  cursor decoding, RLS-equivalent default for RPC, bounded `in` filters,
  governed joins, validated CSV delimiters, and bounded exports.

## Impact

- Affected code: `services/adapters/src/postgresql-data-api.mjs`,
  shared policy contract in `services/internal-contracts/`.
- Migrations: none.
- Breaking changes: callers that today bulk-insert cross-tenant rows or
  rely on unbounded `in` lists / `export` rows will receive HTTP 400.
- Out of scope: governance-admin policy bugs
  (`fix-d1-governance-policy-correctness`); structural admin bugs
  (`harden-d1-structural-admin`); session-context preconditions
  (`fix-d1-rls-session-context`).
