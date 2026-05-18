## 1. Failing tests

- [ ] 1.1 [test] Add a `helm template charts/in-falcone --set
      platform.network.exposureKind=LoadBalancer` smoke; assert the
      rendered output contains exactly one `kind: Service` of type
      `LoadBalancer` (not four).
- [ ] 1.2 [test] Add a render test asserting `validate.yaml` fails when any
      component's `image.tag` equals `latest`; today the validator ignores
      tags (G22).
- [ ] 1.3 [test] Add a unit test for the `normalise-repository` helper
      asserting `ghcr.io/example/foo:tag` is left unchanged when
      `global.imageRegistry.rewriteFullyQualified` is false.

## 2. Implementation

- [ ] 2.1 [fix] In
      `charts/in-falcone/charts/vault/templates/vault-audit-sidecar.yaml`
      add an init-container that runs `kubectl wait --for=condition=ready`
      on the Vault Active pod and the Kafka Service before the sidecar
      starts.
- [ ] 2.2 [fix] In `charts/in-falcone/charts/eso/templates/eso-rbac.yaml`
      replace the ClusterRole with a Role-per-namespace driven by
      `eso.clusterSecretStoreScope[]`; default scope to
      `[in-falcone, vault-escrow]`.
- [ ] 2.3 [fix] In `charts/in-falcone/charts/component-wrapper/templates/_helpers.tpl:30-45`
      skip the registry rewrite when `global.imageRegistry.rewriteFullyQualified`
      is false (default).
- [ ] 2.4 [fix] In `charts/in-falcone/templates/public-surface.yaml:59` add
      a `combineBindingsIntoSingleService` flag for the `LoadBalancer`
      branch; default true; render a single LB Service multiplexing all
      four public bindings.
- [ ] 2.5 [fix] Extend `charts/in-falcone/templates/validate.yaml` to fail
      when any enabled component's `image.tag` is `latest`; warn when the
      bootstrap RoleBinding's `resourceNames` does not include both
      `bootstrap.lock.name` and `bootstrap.markers.name`.

## 3. Validation

- [ ] 3.1 [docs] Document the new ESO scope value, the registry-rewrite
      opt-in, and the LoadBalancer single-Service default in
      `charts/in-falcone/README.md`.
- [ ] 3.2 [test] Run the three render smokes plus `openspec validate
      harden-p1-eso-and-public-surface --strict`; all green.
