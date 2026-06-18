# Tasks — fix-executor-ferretdb-netpol-labels

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: executor mongo insert → 500 (timeout); after adding `app.

## Implement (kind runtime AND shippable product)
- [ ] Set `app.kubernetes.io/name: control-plane-executor` on the executor pod template; align the chart `controlPlaneExecutor` labels with the NetworkPolicy contract.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Executor mongo CRUD 2xx on a clean deploy.

## Archive
- [ ] `openspec validate fix-executor-ferretdb-netpol-labels --strict`; `/opsx:archive fix-executor-ferretdb-netpol-labels` after merge.
