# Tasks — fix-executor-ddl-db-ownership-guard

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Trust-header `POST /v1/postgres/databases/in_falcone/schemas` -> schema created in `in_falcone` (verified).

## Implement (kind runtime AND shippable product as applicable)
- [ ] Resolve/validate the target DB against the caller's workspace ownership; reject `in_falcone` and non-owned DBs (fail-closed); set `GATEWAY_SHARED_SECRET` on the executor so it does not openly honor trust headers.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: DDL on a non-owned DB or `in_falcone` -> 403; own-workspace DDL unaffected; the executor rejects unsigned trust headers.

## Archive
- [ ] `openspec validate fix-executor-ddl-db-ownership-guard --strict`; `/opsx:archive fix-executor-ddl-db-ownership-guard` after merge.
