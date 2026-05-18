## Why

`GET /v1/scheduling/jobs?status=…` in the scheduling-engine concatenates the
caller-supplied `status` query parameter directly into a SQL string. From
`openspec/audit/cap-i1-scheduling-engine.md`:

- **B1** (`services/scheduling-engine/actions/scheduling-management.mjs:158`) —
  the LIST handler builds `${params.query?.status ? "AND status = '" + params.query.status + "'" : ''}`,
  interpolating the raw query string with literal single quotes. A caller passing
  `?status=x' OR '1'='1` escapes the predicate and reads every job in the tenant.
  Escalation to `'; SELECT … FROM other; --` is possible. This is the most severe
  defect found in the I1 audit.
- **G11** (same file:line) — flagged the same concatenation as a gap; the audit
  notes no test asserts the injection vector exists.

## What Changes

- Replace the string concatenation at `scheduling-management.mjs:158` with a
  parameterised binding (`AND status = $N`) and reject any `status` value not in
  the enum `{active, paused, errored, deleted}`.
- Add a contract test that submits `?status=x' OR '1'='1` and asserts the
  request is rejected with `400 INVALID_QUERY` rather than returning rows.
- Audit every other handler in `actions/` for `+`-style SQL building; the audit
  found one site but the pattern is suspicious and a quick sweep is cheap.

## Capabilities

### Modified Capabilities

- `functions-runtime`: parameterise the LIST query and enforce a server-side
  enum on the `status` filter.

## Impact

- Affected code: `services/scheduling-engine/actions/scheduling-management.mjs`.
- Migrations: none.
- Breaking changes: callers passing non-enum `status` values now receive
  `400 INVALID_QUERY` instead of zero rows; intentional.
- Out of scope: rate-limit or audit-trail changes for blocked injection
  attempts — addressed under `harden-i1-trigger-races-and-events`.
