# Tasks — fix-flows-worker-pg-env-and-search-attrs

## Reproduce (test-first)
- [x] `tests/blackbox/flows-worker-pg-env-and-search-attrs.test.mjs` — fails on old code: the campaign worker manifest carried no PG env (DSN → localhost fallback) and no search-attribute registration.

## Implement (kind runtime AND shippable product as applicable)
- [x] `tests/live-campaign/advanced-caps.sh`: worker deployment now sets `PGHOST/PGPORT/PGUSER/PGPASSWORD` (from the postgres Secret) and `PGDATABASE=in_falcone`; adds a step that registers the 5 custom search attributes against the dev Temporal.
- [x] `deploy/kind/values-kind-advanced.yaml`: fix worker `PGDATABASE` `falcone` → `in_falcone` (the registry/data DB).
- [x] `charts/in-falcone/values.yaml`: document the worker's PG env in the overlay example (chart leaves connection env to the overlay).

## Verify
- [x] `node --test tests/blackbox/flows-worker-pg-env-and-search-attrs.test.mjs` green; `flows-worker-db-activity-wiring` unaffected; `bash -n advanced-caps.sh` OK.
- [x] Acceptance: the `db.query` activity connects with real PG env (no localhost fallback / UPSTREAM_UNAVAILABLE); the 5 search attributes are registered so flow start doesn't 500.

## Archive
- [ ] `openspec validate fix-flows-worker-pg-env-and-search-attrs --strict`; `/opsx:archive fix-flows-worker-pg-env-and-search-attrs` after merge.
