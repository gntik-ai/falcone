## 1. Failing tests

- [ ] 1.1 [test] Add a static smoke that greps
      `deploy/apisix/routes/*.yaml` (and the new `charts/in-falcone/
      templates/apisix-routes/*.yaml`) for the substring `keycloak-openid`;
      assert zero matches. Today the test fails on `webhooks.yaml:7`.
- [ ] 1.2 [test] Add a smoke that greps the same files for `\${[A-Z_]+}`
      shell placeholders; assert zero matches. Today fails on
      `scheduling.yaml:13-14`.
- [ ] 1.3 [test] Add a `helm template charts/in-falcone --set
      releaseNamespace=in-falcone` smoke and assert every APISIX route
      upstream FQDN ends in `.in-falcone.svc.cluster.local`.

## 2. Implementation

- [ ] 2.1 [fix] In `deploy/apisix/routes/webhooks.yaml:7` change
      `keycloak-openid` to `openid-connect`; align config keys with the
      `openid-connect` plugin schema.
- [ ] 2.2 [fix] In `deploy/apisix/routes/scheduling.yaml:13-14` replace
      `${KEYCLOAK_DISCOVERY_URL}` and `${KEYCLOAK_CLIENT_ID}` with Helm
      template references `{{ .Values.identity.discoveryUrl }}` and
      `{{ .Values.identity.clientId }}`.
- [ ] 2.3 [fix] In `scheduling.yaml:18` change upstream to
      `scheduling-management.{{ .Release.Namespace }}.svc.cluster.local:80`.
- [ ] 2.4 [migration] Move both YAMLs from `deploy/apisix/routes/` into
      `charts/in-falcone/templates/apisix-routes/`; remove the now-empty
      `deploy/apisix/routes/` directory.
- [ ] 2.5 [impl] Add `identity.discoveryUrl`, `identity.clientId` keys to
      `charts/in-falcone/values.yaml`; reference them from the moved
      templates.

## 3. Validation

- [ ] 3.1 [docs] Document the new template-rendered APISIX route path in
      `charts/in-falcone/README.md`.
- [ ] 3.2 [test] Run the three smokes plus `openspec validate
      fix-p1-apisix-route-files --strict`; all green.
