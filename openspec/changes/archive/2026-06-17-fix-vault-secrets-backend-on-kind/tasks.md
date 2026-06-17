# Tasks — fix-vault-secrets-backend-on-kind

## Decision
- [x] Chose option (b): a self-signed TLS path on kind. The ESO → Vault wiring already exists (the
  `vault-backend` ClusterSecretStore + platform ExternalSecrets), so the only gap was that the
  cert-manager `Certificate` aborts the release on a cluster without cert-manager.

## Implementation
- [x] `vault` subchart: added `vault.tls.mode` (`cert-manager` default | `self-signed`).
  `templates/vault-tls-certificate.yaml` renders the cert-manager Certificate only in cert-manager
  mode.
- [x] Added `charts/in-falcone/charts/vault/templates/vault-tls-bootstrap.yaml`: a pre-install/
  pre-upgrade hook Job (+ Role/SA/RoleBinding) that generates a self-signed cert with openssl
  (Vault Service SANs via `-addext`; the cert is its own trust anchor, so `ca.crt == tls.crt`) and
  writes the `vault-server-tls` Secret. Idempotent (skips if the Secret already has a tls.crt).
- [x] ESO's `vault-backend` ClusterSecretStore + the platform ExternalSecrets resolve app secrets
  from Vault, trusting the bootstrapped CA (caProvider reads vault-server-tls/ca.crt).
- [x] Added `deploy/kind/values-kind-vault.yaml` overlay enabling Vault + ESO + the self-signed path.

## Verification
- [x] `helm template` with the overlay renders no `cert-manager.io/v1` resource and the bootstrap
  Job; rendered bootstrap script is valid bash; executed against real openssl, the cert carries the
  Vault SANs and `-checkhost vault.secret-store.svc.cluster.local` matches.
- [x] ESO ClusterSecretStore (vault provider) + ≥1 ExternalSecret render (end-to-end Vault path).
- [x] Black-box test `tests/blackbox/vault-secrets-backend-kind.test.mjs` (bbx-c6-01..04).
- [x] Run `bash tests/blackbox/run.sh`.
- [x] `openspec validate fix-vault-secrets-backend-on-kind --strict`.

## Archive
- [x] `/opsx:archive fix-vault-secrets-backend-on-kind`
