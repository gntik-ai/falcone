## 1. Ownership resolution

- [x] 1.1 Add an ownership lookup in `secret-rotation-repo.mjs` that resolves `(domain, tenant_id)` for a `secret_path` from `secret_metadata` (`getSecretOwner`)
- [x] 1.2 Add a tenant predicate to the existing version-state queries (`getActiveVersion`, `getGraceVersion`, `getVersionByVaultVersion`, `transitionToGrace`, `revokeVersion`) — backward-compatible optional `tenantId` (null = no restriction)

## 2. Authorization binding

- [x] 2.1 In `secret-rotation-initiate.mjs::main`, resolve the owner of `secretPath` and assert it equals the verified caller tenant before `vaultClient.writeSecret`
- [x] 2.2 In `secret-rotation-revoke.mjs::main`, resolve the owner of `secretPath` and assert it equals the verified caller tenant before `vaultClient.deleteSecretVersion`
- [x] 2.3 Return 403 (no side effects) on any mismatch; treat `auth.tenantId` as trusted and `secretPath`/`tenantId` params as untrusted (`assertSecretRotationOwnership`)

## 3. Verification

- [x] 3.1 Add black-box test `bbx-secrets-rotation-cross-tenant-01`: tenant A cannot rotate/revoke tenant B's secret (expect 403, no Vault side effect)
- [x] 3.2 Add black-box test: same-tenant rotation still succeeds
- [x] 3.3 Run `bash tests/blackbox/run.sh` and confirm green
