## 1. Failing tests proving the bugs

- [ ] 1.1 [test] Add an assertion to
      `tests/contracts/websockets-openapi.contract.test.mjs` that
      `paths['/v1/websockets/sessions'].post['x-owning-service']`
      equals `'realtime_gateway'`. Today this fails (value is
      `'event_gateway'`).
- [ ] 1.2 [test] Add a helm-template assertion
      `tests/charts/mongo-captures-route-uris.test.mjs` that the
      rendered APISIX routes for the `mongo-captures` family use the
      `/v1/mongo-captures/` prefix, not `/v1/realtime/.../mongo-captures/`.
- [ ] 1.3 [test] Add a helm-template assertion that `helm template
      charts/realtime-gateway/` with no overlay fails fast (or emits a
      `lookup`-time error) when `apisix.jwtAuth.jwksUri` is empty;
      assert no rendered manifest contains `keycloak.example`.

## 2. Implementation

- [ ] 2.1 [fix] Change
      `apps/control-plane/openapi/families/websockets.openapi.json:684`
      `x-owning-service` from `event_gateway` to `realtime_gateway`;
      regenerate downstream contract artefacts.
- [ ] 2.2 [fix] Rename route 2014 in `charts/in-falcone/values.yaml:1175-1190`
      from `/v1/realtime/workspaces/{workspaceId}/mongo-captures/*` to
      `/v1/mongo-captures/workspaces/{workspaceId}/*`.
- [ ] 2.3 [fix] Rename route 2015 in `charts/in-falcone/values.yaml:1191-1206`
      from `/v1/realtime/tenants/{tenantId}/mongo-captures/summary/*`
      to `/v1/mongo-captures/tenants/{tenantId}/summary/*`.
- [ ] 2.4 [migration] Add a temporary APISIX rewrite from the old
      `/v1/realtime/.../mongo-captures/*` URIs to the new
      `/v1/mongo-captures/...` URIs covering one release; document the
      deprecation window in PR.
- [ ] 2.5 [fix] Remove the `https://keycloak.example/...` defaults at
      `charts/realtime-gateway/values.yaml:13-14, 17-18`; add a
      `required` Helm helper that fails template rendering if either
      value is empty.

## 3. Validation

- [ ] 3.1 [test] Run `corepack pnpm test:contracts -- websockets-openapi`
      and `corepack pnpm test:charts -- mongo-captures-route-uris
      realtime-gateway`, plus `openspec validate
      fix-f2-route-misalignment --strict`; all green before merge.
