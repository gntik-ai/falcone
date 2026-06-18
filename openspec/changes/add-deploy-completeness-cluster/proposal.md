# add-deploy-completeness-cluster

## Change type
enhancement

## Capability
control-plane-runtime

## Priority
P2

## Why
(a) No workspace GET/DELETE API (only tenant purge cascades) → a single project can't be torn down. (b) Vault is not viable on kind (cert-manager absent → enabling it aborts the release) and no component reads from Vault. (c) Prometheus scrapes only 3 targets (APISIX down).

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** Live: no `DELETE /v1/workspaces/{id}` route; Vault pod absent; Prometheus targets = 3.

GitHub issue #562 (epic #542). Evidence: `audit/live-campaign/evidence/26-lifecycle-governance.md`.

## What Changes
Add a workspace GET/DELETE API with cascading cleanup; either wire Vault (ESO/agent + cert-manager) or document it out-of-scope on kind; widen the Prometheus scrape config.

## Impact
A workspace can be deleted via API with full cleanup; scrape covers APISIX + services.
