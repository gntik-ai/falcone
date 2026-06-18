# Tasks — fix-flows-worker-db-activity-wiring

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: create→publish→`POST .

## Implement (kind runtime AND shippable product)
- [ ] Inject/configure the postgres (and mongo/storage/event) executor into the workflow-worker activities (DSN + tenant RLS context) via the chart `workflowWorker.config`.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: A `db.query` flow inserts/reads a tenant-scoped row and the execution completes successfully.

## Archive
- [ ] `openspec validate fix-flows-worker-db-activity-wiring --strict`; `/opsx:archive fix-flows-worker-db-activity-wiring` after merge.
