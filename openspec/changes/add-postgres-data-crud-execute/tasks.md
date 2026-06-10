## 1. Baseline

- [ ] T01 Confirm baseline green: `bash tests/blackbox/run.sh`
- [ ] T02 Confirm `openspec validate add-postgres-data-crud-execute --strict` passes

## 2. Black-box tests (write first; must be red before implementation)

- [ ] T03 Write failing test `bbx-data-insert-list` against `tests/env` real Postgres:
  insert a row via `POST /v1/collections/{name}/documents`, then `GET /v1/collections/{name}/documents`,
  assert the inserted row is present in the list response
- [ ] T04 Write failing test `bbx-data-filter-pagination`: POST to `/v1/collections/{name}/query`
  with an `eq` filter and `page[size]=2`; assert only matching rows returned and
  `page.after` cursor present when more rows exist
- [ ] T05 Write failing test `bbx-data-rls-anon-isolation`: as an anon-key caller with
  `auth.uid()` = user-A, list rows on a table with RLS policy `owner_id = auth.uid()`;
  assert rows for user-B are absent from the response
- [ ] T06 Write failing test `bbx-data-rls-with-check-blocks`: as anon-key caller for
  tenant-A attempt to insert a row with `tenant_id` = tenant-B; assert HTTP 403 and
  no row written
- [ ] T07 Write failing test `bbx-data-bulk-insert`: POST bulk insert of 5 rows; assert
  all 5 present in a subsequent list and response lists all 5 row identifiers
- [ ] T08 Write failing test `bbx-data-rpc`: invoke a workspace routine via `rpc` operation;
  assert HTTP 200 and response contains the function return value
- [ ] T09 Write failing test `bbx-data-error-constraint`: insert a row that violates a
  unique constraint; assert HTTP 409 with `code: "CONFLICT"` and an opaque `reference`
  field but no SQL fragment in the response body
- [ ] T10 Write failing test `bbx-data-error-bad-input`: supply a non-castable value for
  a typed column; assert HTTP 400 and no SQL text in the response body
- [ ] T11 Confirm all T03–T10 tests are red against the current codebase before any
  implementation is applied
- [ ] T12 Run `bash tests/blackbox/run.sh`; record pre-implementation failure output

## 3. Executor implementation

- [ ] T13 Add `executePostgresDataApiPlan(plan, { connectionRegistry })` to
  `apps/control-plane/src/postgres-data-api.mjs`:
  - Acquire workspace connection as `plan.effectiveRoleName` via `connectionRegistry.acquireForWorkspace`
  - Emit `SET LOCAL` for each entry in `plan.trace.sessionSettings` before the main query
  - Execute `plan.sql.text` with `plan.sql.values`
  - Return mapped response: rows array + `page.next_cursor` when result count equals `plan.page.size`
- [ ] T14 Add count sub-plan execution: when `plan.response.countMode !== 'none'`, run
  `plan.response.count.sql` in the same transaction and include `count` in the response
- [ ] T15 Add bulk transaction wrapper: for `bulk_insert`, `bulk_update`, `bulk_delete`
  wrap the execution in an explicit `BEGIN … COMMIT` block; roll back on any error
- [ ] T16 Add pg error mapping:
  - `23505`, `23503` (unique/FK constraint) → HTTP 409, `code: "CONFLICT"`
  - `22*`, `42803`, `42P18` (invalid input / type cast) → HTTP 400, `code: "BAD_INPUT"`
  - `42501` (insufficient privilege / RLS denial) → HTTP 403, `code: "FORBIDDEN"`
  - All others → HTTP 500, `code: "INTERNAL_ERROR"`
  - All errors include an opaque `reference` UUID; raw pg message logged internally only

## 4. Route handler wiring

- [ ] T17 Wire `list` and `get` route handlers to call `buildPostgresDataApiPlan` then
  `executePostgresDataApiPlan`; return paginated row array
- [ ] T18 Wire `insert` handler; return the `RETURNING` row set with HTTP 201
- [ ] T19 Wire `update` and `delete` handlers; return the `RETURNING` row set with HTTP 200
- [ ] T20 Wire `bulk_insert`, `bulk_update`, `bulk_delete` handlers; return row identifier
  array with HTTP 200
- [ ] T21 Wire `rpc` handler; return the function result set with HTTP 200
- [ ] T22 Wire `export` handler; stream the result set as NDJSON with HTTP 200

## 5. Integration verification

- [ ] T23 Run `bash tests/blackbox/run.sh`; confirm T03–T10 tests pass (green)
- [ ] T24 Confirm all existing blackbox, contract, and unit tests still pass
- [ ] T25 Manually verify via `tests/env` docker-compose: insert → list round-trip returns
  inserted row; anon-key list on RLS-protected table filters correctly
- [ ] T26 Run `openspec validate add-postgres-data-crud-execute --strict`
