## 1. Failing tests

- [ ] 1.1 [test] Add a `helm template charts/in-falcone --set
      vault.enabled=true` smoke and assert the rendered Vault init Job
      contains a step that writes the unseal keys to a Kubernetes Secret;
      today the Job extracts and discards them at
      `vault-init-job.yaml:26-32`.
- [ ] 1.2 [test] Add a smoke that renders the umbrella with
      `vault.unsealKeyEscrow.mode` unset and asserts `validate.yaml` fails
      the render.

## 2. Implementation

- [ ] 2.1 [fix] In
      `charts/in-falcone/charts/vault/templates/vault-init-job.yaml:25-32`
      replace the discard step with a mode-switched escrow:
      `kubernetesSecret`/`kms`/`external`. Default to `kubernetesSecret`.
- [ ] 2.2 [impl] Add `charts/in-falcone/charts/vault/templates/vault-escrow-rbac.yaml`
      with a `vault-escrow` namespace, a dedicated ServiceAccount, and a
      Role granting `get` on the escrow Secrets only — no `update`/`delete`.
- [ ] 2.3 [impl] Add `vault.unsealKeyEscrow.{mode,kms,external}` to
      `charts/in-falcone/charts/vault/values.yaml`; document each mode's
      contract in the chart `README.md`.
- [ ] 2.4 [fix] Extend `charts/in-falcone/templates/validate.yaml` to fail
      render when `vault.enabled=true` and `vault.unsealKeyEscrow.mode` is
      unset.

## 3. Validation

- [ ] 3.1 [docs] Document the SPOF risk, the three escrow modes, and the
      operator recovery workflow in `charts/in-falcone/charts/vault/README.md`.
- [ ] 3.2 [test] Run the two `helm template` smokes plus `openspec validate
      fix-p1-vault-init-spof --strict`; both green.
