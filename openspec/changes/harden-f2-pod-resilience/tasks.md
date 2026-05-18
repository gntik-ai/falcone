## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add `tests/charts/realtime-gateway-keycloak-client.test.mjs`
      asserting `helm template charts/in-falcone/` produces a Keycloak
      client entry named `realtime-gateway` alongside the existing
      `in-falcone-gateway`/`in-falcone-console` entries.
- [ ] 1.2 [test] Add `tests/charts/realtime-gateway-probes.test.mjs`
      asserting the rendered Deployment uses two distinct probe paths:
      `livenessProbe.httpGet.path = /healthz/live`,
      `readinessProbe.httpGet.path = /healthz/ready`.
- [ ] 1.3 [test] Add an assertion that the rendered Deployment carries
      `resources.requests.memory` and `resources.limits.memory`
      values.
- [ ] 1.4 [test] Add an assertion that the chart renders a
      `PodDisruptionBudget` with `minAvailable: 1` and a
      `replicaCount` default of `2`.

## 2. Implementation

- [ ] 2.1 [fix] Add the `realtime-gateway` Keycloak client to
      `charts/in-falcone/values.yaml:360-398`, mirroring the
      `in-falcone-gateway` shape; document the ESO source for the
      client secret.
- [ ] 2.2 [fix] Split the probes at
      `charts/realtime-gateway/templates/deployment.yaml:61-68`:
      liveness at `/healthz/live`, readiness at `/healthz/ready`;
      adjust initial-delay and period thresholds independently.
- [ ] 2.3 [fix] Add a `resources:` block to the Deployment with
      `requests: {memory: 256Mi, cpu: 100m}` and `limits: {memory:
      1Gi, cpu: 500m}`; surface the values in `values.yaml`.
- [ ] 2.4 [fix] Raise `replicaCount` default from `1` to `2` in
      `charts/realtime-gateway/values.yaml:6`.
- [ ] 2.5 [impl] Add
      `charts/realtime-gateway/templates/poddisruptionbudget.yaml`
      with `minAvailable: 1`.

## 3. Validation

- [ ] 3.1 [docs] Document the resilience defaults and the cross-pod
      session-affinity limitation in `charts/realtime-gateway/README.md`.
- [ ] 3.2 [test] Run `corepack pnpm test:charts -- realtime-gateway`
      and `openspec validate harden-f2-pod-resilience --strict`; both
      green before merge.
