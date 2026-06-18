# Tasks — add-deploy-completeness-cluster

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe that reproduces: Live: no `DELETE /v1/workspaces/{id}` route; Vault pod absent; Prometheus targets = 3.

## Implement (kind runtime AND shippable product)
- [ ] Add a workspace GET/DELETE API with cascading cleanup; either wire Vault (ESO/agent + cert-manager) or document it out-of-scope on kind; widen the Prometheus scrape config.
- [ ] Apply the same fix in both `deploy/kind/control-plane/*` and `apps/control-plane`/`services/*` as applicable.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: A workspace can be deleted via API with full cleanup; scrape covers APISIX + services.

## Archive
- [ ] `openspec validate add-deploy-completeness-cluster --strict`; `/opsx:archive add-deploy-completeness-cluster` after merge.
