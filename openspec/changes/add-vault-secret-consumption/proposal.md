# add-vault-secret-consumption

## Change type
enhancement

## Capability
secrets

## Priority
P2

## Why
Vault can be deployed on kind via `vault.tls.mode` (no cert-manager needed), but no Falcone component reads secrets from Vault — every app/datastore reads native k8s Secrets (ESO disabled, no agent injection). 'Secrets via Vault' is unwired regardless of whether the Vault pod runs. (Initially treated as an expected gap; the chart supports Vault, so the gap is the missing consumer.)

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Live: `vault.enabled=false` in the campaign; the vault subchart supports a non-cert-manager `tls.mode`; app source has no Vault/VAULT_ADDR consumer; provisioning-orchestrator secret-rotation actions read k8s secrets.

GitHub epic G. Evidence: `audit/live-campaign/evidence-rerun/15-secrets-metrics-cdc-console-backup.md`.

Code investigation (2026-06-19) confirmed the gap precisely: the chart already makes Vault
*deployable* on kind (self-signed TLS) with an ESO path for *platform* secrets, and the
provisioning-orchestrator has a `vaultClient` seam (`writeSecret`/`deleteSecretVersion`) — but it is
a **no-op stub**, nothing passes a real client, and **no component reads `VAULT_ADDR`**. So the
tenant-facing secrets-as-a-service is unwired: there is no Vault client implementation at all.

## What Changes
**Approach (2026-06-19, confirmed with the operator): a direct Vault KV v2 client in the
control-plane** (over ESO/agent-injection — most directly demonstrable and matches the existing seam).

- A real Vault KV v2 client + per-tenant/per-workspace workspace-secret store
  (`deploy/kind/control-plane/vault-secrets.mjs`): write/read/list/delete + `resolveEnv`.
- WRITE path: `POST/GET/DELETE /v1/functions/workspaces/{ws}/secrets[/{name}]` store the value in
  Vault at the caller's tenant/workspace path; values are write-only (GET/LIST = metadata only).
- READ path: function deploy resolves declared secret refs from Vault and injects them as env vars
  into the Knative Service (`function-executor.mjs` `ksvcManifest` secretEnv).
- Tenant/workspace are credential-derived; cross-tenant access → 404 (no existence leak).
- kind: the existing `values-kind-vault.yaml` self-signed-TLS overlay now also wires the control-plane
  to consume Vault (additive `envFromSecrets` + CA volume), keeping the default render Vault-free.
- Inert by default: with `VAULT_ADDR`/`VAULT_TOKEN` unset the API returns 501 and deploys ignore refs.

## Impact
A secret set via the API is stored in Vault and made available (isolated per env) to a function/service.

- `deploy/kind/control-plane/vault-secrets.mjs` (new), `fn-handlers.mjs` (write API + deploy injection),
  `function-executor.mjs` (secretEnv), `routes.mjs` (4 secret routes), `Dockerfile` (COPY).
- `deploy/kind/values-kind-vault.yaml` (control-plane Vault consumption wiring).
- Tests: `tests/blackbox/vault-workspace-secrets.test.mjs` (vs a fake Vault KV v2 server).
