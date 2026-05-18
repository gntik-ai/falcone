## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add `charts/in-falcone/tests/bootstrap-ensure-scope-pagination.test.mjs`
      with a fake Keycloak admin API returning a paginated client-scope list
      where a scope exists on page 2; assert `ensure_keycloak_client_scope`
      issues no duplicate POST, proving B8/G12 from
      `bootstrap-script-configmap.yaml:191-220`.
- [ ] 1.2 [test] Add a case where the fake admin API returns a non-409 error
      to the create POST; assert the bootstrap loop aborts non-zero, proving
      the fail-open concern in B8.
- [ ] 1.3 [test] Add `scripts/validate-scope-manifests.test.mjs` that runs the
      new validator and asserts it detects (a) a scope literal referenced in
      code that is missing from manifests, (b) a role named in a manifest that
      is missing from `values.yaml::realmRoles`, (c) a manifest with an inline
      `roles:` block, proving G10.

## 2. Implementation

- [ ] 2.1 [fix] Rewrite `ensure_keycloak_client_scope` in
      `charts/in-falcone/templates/bootstrap-script-configmap.yaml:191-220` to
      iterate paginated `?first=&max=` requests until a short page is returned;
      search the accumulated set.
- [ ] 2.2 [fix] Add `set -euo pipefail` at the top of the helper if absent and
      explicit `|| exit 1` on the calling loop at `:376-381`.
- [ ] 2.3 [impl] Add `scripts/validate-scope-manifests.mjs` enforcing the
      manifest schema and the cross-checks listed above; expose it via
      `package.json:scripts.validate-scopes` and add it to the umbrella
      `validate` script.

## 3. Docs and validation

- [ ] 3.1 [docs] Document the bootstrap pagination contract and the validator
      flow in `charts/in-falcone/README.md` and `scripts/README.md`.
- [ ] 3.2 [test] Run targeted tests +
      `openspec validate harden-b1-bootstrap-pagination-and-validator --strict`;
      both green.
