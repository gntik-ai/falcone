# fix-vault-secrets-backend-on-kind

## Change type
bug-fix

## Capability
secrets (cap-secrets)

## Priority
P2

## Why (Problem Statement)
Enabling the Vault subchart aborts the release because Vault's TLS certificate is a
`cert-manager.io/v1 Certificate` resource, but cert-manager is absent on a kind
cluster. Additionally, no Falcone component currently reads secrets from Vault (ESO
is disabled) — so "Vault as secrets backend" is not wired end-to-end.

**Evidence (live campaign 2026-06-17):**
- `vault.enabled=true` → install aborts on the `Certificate` CRD (cert-manager absent).
- All apps use `envFromSecrets`/`secretKeyRef` (plain k8s Secrets).
- ESO disabled; no component fetches from Vault.
- D7 in the campaign report.

## What Changes
Either:
(a) Ship cert-manager dependency + ESO wiring so Vault is a real secrets backend, or
(b) Make Vault opt-in with a self-signed TLS path on kind (no cert-manager required)
and wire at least one app secret through Vault to prove end-to-end resolution.

## Impact
- **Operational:** Vault is advertised as the secrets backend but is non-functional.
- **Breaking change:** none (opt-in feature).
- **Dependencies:** cert-manager (if option a) or TLS self-sign tooling (if option b).
