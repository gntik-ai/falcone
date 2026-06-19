# Tasks — fix-data-api-contract-mismatches

## Reproduce (test-first)
- [x] `tests/env/executor/functions-executor.test.mjs`: deploy with `{ source: { inlineCode } }` then invoke.
- [x] `tests/env/executor/control-plane-http.test.mjs`: bulk insert at `.../tables/{t}/bulk/insert`; api-key list camelCase.

## Implement (kind runtime AND shippable product as applicable)
- [x] Mongo provision (`deploy/kind/control-plane/mongo-handlers.mjs`): accept `databaseName` as well as `name`.
- [x] Functions deploy (`apps/control-plane/src/runtime/functions-executor.mjs`): unwrap `source.inlineCode`/`source.code`
      to the code string (and default runtime from `source.kind`).
- [x] Bulk insert route (`apps/control-plane/src/runtime/server.mjs`): match both `.../bulk/insert`
      (catalog path) and `.../rows/bulk/insert`.
- [x] API-key list (`apps/control-plane/src/runtime/api-keys.mjs`): return camelCase fields mirroring `issueKey`.

## Verify
- [x] `node --test tests/env/executor/functions-executor.test.mjs` green (9/9).
- [x] `node --test tests/env/executor/control-plane-http.test.mjs` green (12/12, incl. catalog-path bulk + camelCase list).
- [x] Acceptance: the documented shapes work; the catalog path resolves; response casing is consistent.

## Archive
- [ ] `openspec validate fix-data-api-contract-mismatches --strict`; `/opsx:archive fix-data-api-contract-mismatches` after merge.
