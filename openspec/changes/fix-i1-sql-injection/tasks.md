## 1. Failing tests

- [ ] 1.1 [test] Add a case to `tests/integration/scheduling-management-action.test.mjs`
      that calls `GET /v1/scheduling/jobs?status=x'%20OR%20'1'='1` and asserts
      the response is `400 INVALID_QUERY`, proving B1 at
      `scheduling-management.mjs:158`.
- [ ] 1.2 [test] Add a case that submits `status=active`, `status=paused`,
      `status=errored`, `status=deleted` and asserts each returns only rows
      with that exact status.

## 2. Implementation

- [ ] 2.1 [fix] Rewrite the LIST predicate at `scheduling-management.mjs:158` to
      use `AND status = $3` with the value pushed onto the bind array; remove
      the `"AND status = '" + … + "'"` concatenation entirely.
- [ ] 2.2 [fix] Add a server-side allow-list at the same handler that rejects
      any `status` value outside `{active, paused, errored, deleted}` with
      `400 INVALID_QUERY`.
- [ ] 2.3 [fix] Grep every file under `services/scheduling-engine/actions/` and
      `services/scheduling-engine/src/` for `${params.` inside template-string
      SQL; convert any other occurrence to a bound parameter.

## 3. Validation

- [ ] 3.1 [docs] Note the parameterisation rule in
      `services/scheduling-engine/README.md`.
- [ ] 3.2 [test] Re-run `corepack pnpm test:contract` and
      `corepack pnpm test:integration`; both green before merge.
