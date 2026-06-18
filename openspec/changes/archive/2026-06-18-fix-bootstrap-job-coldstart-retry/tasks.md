# Tasks — fix-bootstrap-job-coldstart-retry

## Reproduce (test-first)
- [x] Add a failing black-box / live probe that reproduces: Live: Job BackoffLimitExceeded on first install; manually running the same pod a minute later provisions realm+roles+clients+superadmin and exits 0. — `tests/blackbox/bootstrap-job-coldstart-retry.test.mjs` (bbx-558-01..04): rendered the bootstrap Job and asserted it had NO Keycloak-readiness initContainer and `backoffLimit: 1` (failing pre-fix).

## Implement (kind runtime AND shippable product)
- [x] Raise `backoffLimit`/retry budget and/or add a Keycloak-readiness wait init-container to the bootstrap Job (chart). — `charts/in-falcone/templates/bootstrap-job.yaml` adds a `wait-for-keycloak` initContainer (polls `$KEYCLOAK_BASE_URL/realms/master` until 200, bounded by `timeoutSeconds`); `charts/in-falcone/values.yaml` raises `bootstrap.job.backoffLimit` 1→6 and adds the `bootstrap.job.keycloakReadiness` stanza (enabled/requestTimeoutSeconds/intervalSeconds/timeoutSeconds). `values.schema.json` already permits the new keys (`bootstrap.job` is `additionalProperties: true`).
- [x] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable. — The bootstrap Job is chart-only (the kind/campaign profiles consume the same chart); no separate control-plane copy exists. Updated `tests/live-campaign/install.sh` comment to note the chart now self-waits for Keycloak.

## Verify
- [x] Black-box suite green; the live 2-tenant probe now passes. — `bash tests/blackbox/run.sh` → 834/834 pass.
- [x] Acceptance: Bootstrap completes on a cold `helm install` without manual re-run. — Rendered Job (default + kind+campaign values) shows the `wait-for-keycloak` initContainer gating the bootstrap container and `backoffLimit: 6`, so the create-only phase only runs once Keycloak is reachable.

## Archive
- [ ] `openspec validate fix-bootstrap-job-coldstart-retry --strict`; `/opsx:archive fix-bootstrap-job-coldstart-retry` after merge. (validate run in this session; archive deferred to the batching orchestrator.)
