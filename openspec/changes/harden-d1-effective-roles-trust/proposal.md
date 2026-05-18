## Why

The PostgreSQL admin trusts caller-supplied `effectiveRoles` from the request
payload, silently downgrades on unknown plan ids, proceeds on `'unknown'`
placement mode with only a warning, and defaults the workspace role prefix
to empty (which makes any role name pass the prefix check). From
`openspec/audit/cap-d1-postgresql-admin-data-api.md`:

- **B-S2.1** (`services/adapters/src/postgresql-admin.mjs:862-864`) —
  `effectiveRoles.some(role => allowed.has(role))` checks set
  membership against the caller's *requested* roles, not against
  authentication. If the upstream API ever forwards the caller's
  claimed roles instead of evaluated roles, any caller who lists
  `workspace_owner` is authorised.
- **B-S2.2** (`postgresql-admin.mjs:407-416`) — quota-guardrails fall
  back to `pln_01growth` / `pln_01regulated` defaults when `planId`
  is unknown, silently downgrading to less-restrictive limits if a
  spoofed or stale planId is supplied.
- **B-S2.3** (`postgresql-admin.mjs:1440-1442`) — placement-mode value
  `'unknown'` proceeds with only a warning; downstream isolation
  depends on placement mode being a known value.
- **B-S2.5** (`postgresql-admin.mjs:1475-1477`) — the workspace role
  prefix check uses a generic `hasPrefix` that returns true for an
  empty prefix, so a missing/empty `workspaceNamePrefix` makes any
  role name match.

## What Changes

- Add a cryptographic-proof check at
  `postgresql-admin.mjs:862-864`: the caller's `effectiveRoles` MUST
  be cross-verified against a signed claim (e.g. a JWT scope set the
  gateway attaches), not merely set-matched against an allow-list.
- Replace the silent quota-fallback at
  `postgresql-admin.mjs:407-416` with a hard rejection on unknown
  `planId`: HTTP 400 `PLAN_UNKNOWN`, no defaults applied.
- Treat placement-mode `'unknown'` at
  `postgresql-admin.mjs:1440-1442` as a violation, not a warning:
  reject the request with HTTP 400 `PLACEMENT_MODE_UNKNOWN`.
- Reject an empty / missing `workspaceNamePrefix` at
  `postgresql-admin.mjs:1475-1477`; a prefix check MUST require a
  non-empty prefix to be meaningful.

## Capabilities

### Modified Capabilities

- `data-services`: cryptographic trust on `effectiveRoles`, hard
  rejection on unknown plan / placement mode, and non-empty workspace
  role prefix requirement.

## Impact

- Affected code: `services/adapters/src/postgresql-admin.mjs`, the
  upstream request layer that constructs claims (e.g.
  `apps/control-plane/src/postgres-admin.mjs`).
- Migrations: none.
- Breaking changes: callers (or upstream layers) that today rely on
  the silent plan downgrade or the empty-prefix permissive match will
  receive errors; this is the intended hardening.
- Out of scope: data-API bulk / quota concerns
  (`harden-d1-data-api-quotas-and-bulk`); structural admin
  (`harden-d1-structural-admin`); governance correctness
  (`fix-d1-governance-policy-correctness`); cross-cutting policy
  adoption (`harden-d1-authorization-policy-adoption`).
