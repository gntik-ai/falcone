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

## What Changes
Wire a secrets backend (ESO/agent injection or a Vault client in the control-plane) so per-tenant/per-env secrets resolve from Vault; enable Vault in the kind profile via the non-cert-manager tls.mode for testing.

## Impact
A secret set via the API is stored in Vault and made available (isolated per env) to a function/service.
