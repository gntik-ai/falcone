# Tasks — add-vault-secret-consumption

## Reproduce (test-first)
- [ ] Add a failing black-box / live probe reproducing: Live: `vault.

## Implement (kind runtime AND shippable product as applicable)
- [ ] Wire a secrets backend (ESO/agent injection or a Vault client in the control-plane) so per-tenant/per-env secrets resolve from Vault; enable Vault in the kind profile via the non-cert-manager tls.mode for testing.

## Verify
- [ ] Black-box suite green; the live 2-tenant probe now passes.
- [ ] Acceptance: A secret set via the API is stored in Vault and made available (isolated per env) to a function/service.

## Archive
- [ ] `openspec validate add-vault-secret-consumption --strict`; `/opsx:archive add-vault-secret-consumption` after merge.
