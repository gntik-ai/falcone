## 1. Failing tests

- [ ] 1.1 [test] Add a `helm template charts/in-falcone --set
      bootstrap.enabled=true` smoke that asserts the rendered Role's
      `rules[?(@.resources.contains "configmaps")].resourceNames` is
      non-empty; today the test fails because the rule has no
      `resourceNames` filter (B13).
- [ ] 1.2 [test] Add a smoke that greps the rendered
      `bootstrap-script-configmap` for `grep -q '"name":"`; assert zero
      matches. Today fails on three sites at `:202, :234, :264`.
- [ ] 1.3 [test] Add a smoke that asserts the rendered script contains a
      `kubectl wait --for=condition=ready` line targeting the Keycloak pod.

## 2. Implementation

- [ ] 2.1 [fix] In `bootstrap-rbac.yaml:20-30` add a `resourceNames` list
      containing `{{ .Values.bootstrap.lock.name }}` and
      `{{ .Values.bootstrap.markers.name }}` only.
- [ ] 2.2 [fix] In `bootstrap-script-configmap.yaml:202, :234, :264`
      replace the `grep`/`sed` JSON checks with `jq` queries (e.g. `jq -e
      --arg name "$scope_name" '.[] | select(.name == $name)'`).
- [ ] 2.3 [fix] At the top of the script add
      `kubectl wait --for=condition=ready --timeout="${BOOTSTRAP_READINESS_TIMEOUT:-600s}"
      pod -l app.kubernetes.io/name=keycloak` and same for `apisix`.
- [ ] 2.4 [impl] Add `run_one_shot_openwhisk` to the script that uses `wsk
      action create` against the OpenWhisk component to register actions
      for L1 backup-status, F3 webhook-engine, I1 scheduling-engine.
- [ ] 2.5 [impl] Add the missing authorization scopes
      (`backup-audit:read:*`, `backup-status:read:*`, `backup:write/restore:*`,
      `platform:admin:config:*`) to `values.bootstrap.oneShot.keycloak
      .clientScopes`; ensure the existing loop at
      `bootstrap-script-configmap.yaml:376-382` provisions them.
- [ ] 2.6 [impl] Update the bootstrap image to install `jq` and `kubectl`
      as required dependencies.

## 3. Validation

- [ ] 3.1 [docs] Document the new readiness contract, the scoped RBAC, and
      the OpenWhisk provisioning step in `charts/in-falcone/README.md`.
- [ ] 3.2 [test] Run the three smokes plus `openspec validate
      fix-p1-bootstrap-script-gaps --strict`; all green.
