# Tasks — fix-vault-secrets-backend-on-kind

## Decision
- [ ] Decide between option (a) cert-manager + ESO or (b) self-signed TLS on kind;
  document as an ADR addendum.

## Implementation
- [ ] If (b): replace the `cert-manager.io/v1 Certificate` with a self-signed TLS
  Job/init-container that writes the cert/key into a Secret.
- [ ] Wire ESO + VaultStaticSecret (or equivalent) to at least one app secret.
- [ ] Add a `values-kind-vault.yaml` overlay that enables Vault on kind with the
  self-signed path.

## Verification
- [ ] `helm install` with `vault.enabled=true` on kind → release installs cleanly.
- [ ] At least one app secret resolves from Vault (not from a plain k8s Secret).
- [ ] Run `/opsx:verify fix-vault-secrets-backend-on-kind`.

## Archive
- [ ] `/opsx:archive fix-vault-secrets-backend-on-kind`
