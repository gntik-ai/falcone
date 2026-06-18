# Tasks — fix-flows-worker-db-activity-wiring

## Reproduce (test-first)
- [x] Add a failing black-box / live probe that reproduces: Live: create→publish→`POST .../executions` throws "postgres executor not wired". Test: `tests/blackbox/flows-worker-db-activity-wiring.test.mjs` (6 scenarios, covers the "not wired" gap + the new wiring API).

## Implement (kind runtime AND shippable product)
- [x] Inject/configure the postgres executor into the workflow-worker activities via a new `services/workflow-worker/src/worker-deps.mjs` module that exports `wireActivityDeps()` and `buildDataDsn()`.
- [x] `services/workflow-worker/src/worker.ts` — calls `wireActivityDeps()` before `worker.run()` and feeds `deps` into `activities.setActivityDeps(deps)`.
- [x] `services/workflow-worker/package.json` — adds `pg` (8.13.1) as a production dependency.
- [x] `services/workflow-worker/scripts/copy-activity-catalog.mjs` — extended to also copy top-level `src/*.mjs` modules (worker-deps.mjs) into `dist/`.
- [x] `services/workflow-worker/Dockerfile` — copies `apps/control-plane/src/runtime/{connection-registry,postgres-data-executor,workspace-dsn-resolver,errors}.mjs` and `services/adapters/src/{postgresql-data-api,postgresql-governance-admin}.mjs` into the image.
- [x] `deploy/kind/values-kind-advanced.yaml` — adds `PGHOST/PGUSER/PGPASSWORD/PGDATABASE` to `workflowWorker.env` so the worker builds its DSN from the kind cluster's Postgres Secret.

## Verify
- [x] Black-box suite green (6/6 new tests pass); no regressions in existing flows tests.
- [x] `openspec validate fix-flows-worker-db-activity-wiring --strict` passes.
- [ ] Live 2-tenant probe: publish a `db.query` flow → `POST .../executions` → execution completes (not Failed), row inserted with tenant_id=tenant_A.

## Archive
- [ ] `/opsx:archive fix-flows-worker-db-activity-wiring` after merge.
