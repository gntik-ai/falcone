# Tasks — fix-ddl-column-contract-and-pk

## Reproduce (test-first)
- [x] Real-Postgres probe in `tests/env/executor/postgres-ddl-executor.test.mjs` exercising the documented
      `{ name, columns:[{ name, type, primaryKey:true }] }` body and asserting a real PK index exists.

## Implement (kind runtime AND shippable product as applicable)
- [x] `services/adapters/src/postgresql-structural-admin.mjs` `normalizeColumnSpec`: fold top-level
      `primaryKey`/`unique`/`checkExpression` into the column constraints and imply NOT NULL for a PK column.
- [x] `apps/control-plane/src/runtime/postgres-ddl-executor.mjs`: resolve the table-name alias
      (`payload.tableName ?? payload.name`) once so the tenant-isolation statements no longer throw
      `Invalid tableName identifier` for a `{ name }` body.

## Verify
- [x] `node --test tests/env/executor/postgres-ddl-executor.test.mjs` green (9/9, incl. the new probe).
- [x] `node --test tests/adapters/postgresql-admin.test.mjs` green (no regression in the structural builder).
- [x] Acceptance: the documented create-table body works and `primaryKey` creates a usable PK.

## Archive
- [ ] `openspec validate fix-ddl-column-contract-and-pk --strict`; `/opsx:archive fix-ddl-column-contract-and-pk` after merge.
