## 1. Failing black-box test

- [x] 1.1 Add a test: seed measurable resources for a tenant, resolve consumption, assert each dimension is measured (non-null, not `NO_QUERY_MAPPING`/`CONSUMPTION_QUERY_FAILED`). Confirm RED. — `tests/env/quota-consumption-live-schema.test.mjs` against real Postgres with the live `in_falcone` table shapes: RED before (resolvers queried `pg_databases`/`functions`/… → FAILED, and `max_mongo_databases`/`max_api_keys` → NO_QUERY_MAPPING); GREEN after (real counts: workspaces 2, pg dbs 3, mongo dbs 1, functions 4, topics 2, api keys 5).
- [x] 1.2 Tenant-scoping probe: another tenant's rows are not counted. — same test asserts the other tenant sees only its own row.

## 2. Fix consumption mappings

- [x] 2.1 Map each catalog dimension to the real live table. — `services/provisioning-orchestrator/src/repositories/consumption-repository.mjs`: `DIMENSION_QUERY_MAP` rewritten to the production `quota_dimension_catalog` keys → live tables (`workspace_databases` split by `engine` for pg/mongo, `workspace_functions`, `workspace_topics`, `workspace_api_keys`, `workspaces`). `makeDimensionQuery` now DECOUPLES the real table from the integration fake-db key (+ an optional `where` for the engine filter), so production hits the right table while the consumption integration suite stays green.
- [x] 2.2 Wire measured values into enforcement. — consumption is now real for the 6 countable dimensions, so the entitlements/quota path enforces against actual usage. `max_storage_bytes` (object store) and `max_workspace_members` (Keycloak) have no control-plane source → measured 0 (documented gap; real metering deferred to #499 / IAM) rather than blocking with NO_QUERY_MAPPING.

## 3. Verify

- [x] 3.1 Re-run — consumption reflects real counts. — env test 2/2; existing consumption suite green: integration/106 7/7, plus observability unit/contract + 103/105 effective-limit suites 35/36 (1 pre-existing skip), 0 fail.
- [x] 3.2 Run `bash tests/blackbox/run.sh` — confirmed in the batch run (no backend contract change to the repo's public shape).
