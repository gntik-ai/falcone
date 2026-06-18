# Tasks — fix-ddl-column-contract-and-pk

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: `columns:[{name,type}]` -> 400 DDL_INVALID; `primaryKey:true` creates no `pg_index` entry.

## Implement (kind runtime AND shippable product as applicable)
- [ ] Accept the documented `name/type` shape (or fix the OpenAPI), and emit a PRIMARY KEY constraint when `primaryKey:true`.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: The documented create-table body works and `primaryKey` creates a usable PK.

## Archive
- [ ] `openspec validate fix-ddl-column-contract-and-pk --strict`; `/opsx:archive fix-ddl-column-contract-and-pk` after merge.
