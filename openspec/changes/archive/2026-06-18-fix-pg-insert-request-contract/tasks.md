# Tasks — fix-pg-insert-request-contract

## Reproduce (test-first)
- [x] Add a failing black-box probe that reproduces the bug: `tests/blackbox/pg-insert-request-contract.test.mjs` bbx-pg-insert-01 — documented `{row:{...}}` body → 400 PLAN_REJECTED "Unknown column row".

## Implement (kind runtime AND shippable product)
- [x] Align the handler with the OpenAPI `PostgresDataInsertRequest` contract: the executor `POST .../rows` route now unwraps `c.body.row` (the documented envelope) before `c.body.values`/bare body — `apps/control-plane/src/runtime/server.mjs`.
- [x] The data plane (`createControlPlaneServer`) is the shared executor for both the kind profile and the shippable product, so the single fix covers both; the kind control-plane proxies data-plane writes to it (no separate kind insert handler). Bulk insert already read `c.body.rows` per `PostgresDataBulkInsertRequest` — unchanged.

## Verify
- [x] Black-box suite green; bbx-pg-insert-01..04 (documented `{row}`, legacy `{values}`, bare body, unknown-column 4xx).
- [x] Acceptance: the documented body inserts a row (captured INSERT binds the row value).

## Archive
- [x] `openspec validate fix-pg-insert-request-contract --strict`; archived with the P2 batch.
