## Why

`services/scheduling-engine/actions/scheduling-management.mjs:156-162` builds the list-jobs SQL query by concatenating the caller-supplied HTTP query parameter `params.query.status` directly into the WHERE clause with no validation or parameterization:

```js
`SELECT * FROM scheduled_jobs WHERE tenant_id = $1 AND workspace_id = $2 AND deleted_at IS NULL ${params.query?.status ? "AND status = '" + params.query.status + "'" : ''} ORDER BY id ASC LIMIT $3`
```

A single-quoted injection payload such as `status=active' OR '1'='1` evaluates true for every row in the table, bypassing the correctly parameterized `tenant_id = $1 AND workspace_id = $2` predicates and returning all tenants' non-deleted jobs. A `UNION SELECT` variant can read from arbitrary tables while `--` strips the `LIMIT`. This is the only string-concatenation SQL in the service; every other query in `scheduling-management.mjs` uses positional placeholders exclusively (lines 165, 169, 184, 190, 196). The valid status set `{active, paused, errored, deleted}` is authoritatively defined by `VALID_TRANSITIONS` keys in `services/scheduling-engine/src/job-model.mjs:4-9` (source finding `bug-005`).

## What Changes

- Replace `"AND status = '" + params.query.status + "'"` with `AND status = $4` and append the validated value to the parameters array.
- Validate `params.query.status` against the allowlist `{active, paused, errored, deleted}` derived from `VALID_TRANSITIONS` in `job-model.mjs`; return HTTP 400 / `INVALID_STATUS` for any value outside the allowlist.
- The fix is localized to `services/scheduling-engine/actions/scheduling-management.mjs:156-162`; no other files change.

## Capabilities

### New Capabilities

- `scheduling`: Tenant-scoped job listing with parameterized status filtering so that SQL injection in the status query parameter cannot bypass tenant/workspace scoping or read cross-tenant rows.

### Modified Capabilities

<!-- none: openspec/specs/ is empty; this introduces the scheduling capability spec -->

## Impact

- `services/scheduling-engine/actions/scheduling-management.mjs:156-162` — sole fix site; string-concatenated SQL replaced with parameterized `$4` and allowlist validation.
- `services/scheduling-engine/src/job-model.mjs::VALID_TRANSITIONS:4-9` — read as the authoritative allowlist source (no change to this file).
- Callers supplying invalid status values now receive HTTP 400 `INVALID_STATUS`; callers supplying valid values or omitting the filter are unaffected.
- Black-box suite: new injection-payload test (`bbx-sched-status-injection-*`) confirming 400 response and no cross-tenant row disclosure.
