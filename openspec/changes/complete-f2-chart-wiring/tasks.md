## 1. Failing tests proving the gaps

- [ ] 1.1 [test] Add a helm-template snapshot test
      `tests/charts/realtime-gateway-service.test.mjs` that runs `helm
      template charts/realtime-gateway/` and asserts the rendered
      output contains a `kind: Service` named `realtime-gateway` on
      port 8080. Today this fails — no template emits a Service.
- [ ] 1.2 [test] Add a helm-template assertion
      `tests/charts/in-falcone-route-targets.test.mjs` that asserts
      APISIX routes for `/realtime/*` and `/v1/websockets/*` reference
      upstream `component: realtimeGateway`. Today this fails — both
      target `controlPlane`.
- [ ] 1.3 [test] Add an assertion that the rendered
      `realtime-gateway-secrets` resource is an `ExternalSecret` (not a
      raw `Secret` with empty `stringData`).

## 2. Implementation

- [ ] 2.1 [impl] Add `charts/realtime-gateway/templates/service.yaml`
      with `kind: Service`, `type: ClusterIP`, port 8080, selector
      matching the Deployment pod labels.
- [ ] 2.2 [impl] Add `realtimeGateway` upstream component in
      `charts/in-falcone/values.yaml` pointing at the new Service DNS.
- [ ] 2.3 [fix] Re-point route 1003 (`charts/in-falcone/values.yaml:839-846`)
      from `component: controlPlane` to `component: realtimeGateway`.
- [ ] 2.4 [fix] Re-point route 2011 (`charts/in-falcone/values.yaml:1126-1142`)
      to `component: realtimeGateway`.
- [ ] 2.5 [migration] Replace
      `charts/realtime-gateway/templates/secret-ref.yaml` with an
      `ExternalSecret` (External Secrets Operator) populating
      `DATABASE_URL`, `KEYCLOAK_INTROSPECTION_CLIENT_SECRET`,
      `KAFKA_BROKERS` from the platform vault.
- [ ] 2.6 [impl] Reference `realtime-gateway-apisix-plugin` ConfigMap
      from the umbrella's APISIX bootstrap so the JWT-auth plugin
      config is consumed.

## 3. Validation

- [ ] 3.1 [docs] Document the required vault paths and the cut-over
      sequence with `complete-f2-transport-binary-and-handler` in
      `charts/realtime-gateway/README.md`.
- [ ] 3.2 [test] Run `corepack pnpm test:charts` and
      `openspec validate complete-f2-chart-wiring --strict`; both green
      before merge.
