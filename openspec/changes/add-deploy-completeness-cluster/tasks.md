# Tasks — add-deploy-completeness-cluster

## Reproduce (test-first)
- [x] Add a failing black-box / live probe that reproduces: no `DELETE /v1/workspaces/{id}` route (NO_ROUTE); Vault would abort on kind (cert-manager absent); Prometheus narrow scrape (3 targets).
  - `tests/blackbox/workspace-delete-cascade.test.mjs`, `tests/blackbox/workspace-delete-product.test.mjs`, `tests/blackbox/deploy-completeness-vault-prometheus.test.mjs` (initially red).

## Implement (kind runtime AND shippable product)
- [x] (a) Workspace GET/DELETE API with cascading cleanup — `DELETE /v1/workspaces/{workspaceId}`.
  - Kind: `tenant-store.mjs::purgeWorkspace`, `b-handlers.mjs::deleteWorkspace` (+ `LOCAL_HANDLERS`), `routes.mjs`.
  - Product: `apps/control-plane/src/workspace-management.mjs::handleWorkspaceDeleteRequest` (wired to the existing public route `deleteWorkspace`).
- [x] (b) Vault documented out-of-scope on kind/campaign (opt-out); kept `vault.enabled: false` on the campaign values; recorded the decision in `design.md` + the spec delta.
- [x] (c) Widened the Prometheus scrape config — namespace-scoped pod service-discovery + scrape annotations on the metrics-exposing components + pod-discovery RBAC; workflow-worker (no `/metrics`) deliberately skipped.

## Verify
- [x] Black-box suite green (853/853, was 834; +19 new) — `bash tests/blackbox/run.sh`.
- [x] Product/contract regressions clear: `tests/unit` (707 pass), `tests/contracts` (232 pass), `helm lint` clean.
- [x] Acceptance: a workspace can be deleted via API with full cleanup (DB dropped, bucket/topics gone, rows removed), tenant-scoped; cross-tenant → 404 with no teardown; scrape covers APISIX + the metrics-exposing services beyond 3 static targets; Vault disabled on kind.

## Archive
- [x] `openspec validate add-deploy-completeness-cluster --strict`.
- [ ] `/opsx:archive add-deploy-completeness-cluster` after merge.
