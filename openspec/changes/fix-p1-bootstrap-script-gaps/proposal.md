## Why

The umbrella's bootstrap script and its RBAC have five separate gaps that
combine into a half-provisioned platform with over-broad ConfigMap mutation
rights and brittle JSON parsing. From
`openspec/audit/cap-p1-helm-charts-and-kubernetes-manifests.md`:

- **B13** (`charts/in-falcone/templates/bootstrap-rbac.yaml:20-30`) — Role
  grants `get, create, update, patch, delete` on **all** ConfigMaps in the
  install namespace; no `resourceNames` filter. Compromised bootstrap can
  mutate `runtime-configmaps`, `bootstrap-payload`, `bootstrap-script`.
- **B18** (`charts/in-falcone/templates/bootstrap-script-configmap.yaml:202,
  :234, :264`) — `grep -q '"name":"'$var'"'` on JSON. Inputs with regex
  metacharacters mis-match or skip checks.
- **B19** (`charts/in-falcone/templates/bootstrap-script-configmap.yaml:99-109`)
  — only `curl --retry 6 --retry-delay 5` against the Keycloak token
  endpoint; no `kubectl wait` for Keycloak/APISIX readiness; ~30-sec budget.
  Slow first-install crashes bootstrap.
- **B20** (entire `bootstrap-script-configmap.yaml`) — script provisions
  Keycloak + APISIX only. OpenWhisk action registration is never performed
  by this script. L1/F3/I1 trees do not connect either.
- **G15** restates B18; **G16** notes the script never provisions the
  authorization scopes referenced from 5 services; **G17** restates B19;
  **G19** restates B13; **G20** restates B20.

## What Changes

- Restrict the bootstrap RBAC to specific `resourceNames` (the lock and
  marker ConfigMaps, named via `bootstrap.lock.name` and
  `bootstrap.markers.name`).
- Replace `grep`/`sed` on JSON with `jq` queries; emit a fail-fast error
  when `jq` is missing from the bootstrap image.
- Add a `kubectl wait --for=condition=ready pod -l
  app.kubernetes.io/name={keycloak,apisix}` step at the top of the script
  with a configurable timeout (default 10 min).
- Extend the script to (a) provision the authorization scopes
  (`backup-audit:read:*`, `backup-status:read:*`, `backup:write/restore:*`,
  `platform:admin:config:*`) currently absent from `client-scope-*.json`,
  and (b) register OpenWhisk actions for L1/F3/I1 via a new
  `run_one_shot_openwhisk` function.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: requirement on bootstrap RBAC scoping,
  JSON-parsing robustness, readiness gating, and end-to-end OpenWhisk +
  authorization-scope provisioning.

## Impact

- **Affected code**:
  `charts/in-falcone/templates/bootstrap-rbac.yaml`,
  `charts/in-falcone/templates/bootstrap-script-configmap.yaml`,
  `charts/in-falcone/templates/bootstrap-job.yaml` (bake `jq` and `kubectl`
  into the image), `charts/in-falcone/values.yaml` (add
  `bootstrap.readiness.timeoutSeconds`).
- **Migration required**: bootstrap image must ship `jq` and `kubectl`.
- **Breaking changes**: bootstrap takes longer on cold cluster (waits for
  Keycloak/APISIX); intended.
