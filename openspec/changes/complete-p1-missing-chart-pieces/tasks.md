## 1. Failing tests

- [ ] 1.1 [test] Add a `helm template charts/realtime-gateway` smoke
      asserting the rendered manifest list contains exactly one `kind:
      Service` resource targeting `containerPort: 8080`; today the test
      fails because no Service template exists.
- [ ] 1.2 [test] Add a `helm template charts/workspace-docs-service` smoke
      asserting the rendered Deployment contains `livenessProbe`,
      `readinessProbe`, `resources.requests`, `securityContext`, and a
      `Service` resource is present; today the test fails on all five
      assertions.
- [ ] 1.3 [test] Add a `helm template charts/in-falcone` smoke (with
      apisix and controlPlane enabled and probe paths supplied) asserting
      the rendered Deployments include probe blocks; today the test fails
      because the wrapper has no probe template.

## 2. Implementation

- [ ] 2.1 [impl] Add `charts/realtime-gateway/templates/service.yaml`
      (ClusterIP, port 8080) and a `resources:` block in
      `charts/realtime-gateway/templates/deployment.yaml:14-69`.
- [ ] 2.2 [impl] Add `charts/workspace-docs-service/templates/service.yaml`;
      extend `deployment.yaml:1-39` with `livenessProbe`, `readinessProbe`,
      `resources`, `securityContext`, `serviceAccountName`; replace bare
      `workspace-docs-service:latest` with a registry-prefixed configurable
      image.
- [ ] 2.3 [impl] Extend
      `charts/in-falcone/charts/component-wrapper/templates/workload.yaml`
      with `livenessProbe`/`readinessProbe`/`startupProbe` blocks populated
      from `.Values.probes.*`; default to off when no path is set.
- [ ] 2.4 [impl] Extend `charts/in-falcone/templates/validate.yaml` with a
      rule that warns when a known-critical component (`apisix, keycloak,
      controlPlane, webConsole`) has no `probes.liveness.path` set.

## 3. Validation

- [ ] 3.1 [docs] Document the new chart-scaffolding pattern (Service +
      probes + resources + securityContext) in `charts/README.md`.
- [ ] 3.2 [test] Run the three `helm template` smokes plus `openspec
      validate complete-p1-missing-chart-pieces --strict`; all green.
