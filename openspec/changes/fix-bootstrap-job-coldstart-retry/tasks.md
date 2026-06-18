# Tasks — fix-bootstrap-job-coldstart-retry

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: Job BackoffLimitExceeded on first install; manually running the same pod a minute later provisions realm+roles+clients+superadmin and exits 0.

## Implement (kind runtime AND shippable product)
- [ ] Raise `backoffLimit`/retry budget and/or add a Keycloak-readiness wait init-container to the bootstrap Job (chart).
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: Bootstrap completes on a cold `helm install` without manual re-run.

## Archive
- [ ] `openspec validate fix-bootstrap-job-coldstart-retry --strict`; `/opsx:archive fix-bootstrap-job-coldstart-retry` after merge.
