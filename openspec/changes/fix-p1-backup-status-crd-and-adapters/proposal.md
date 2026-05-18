## Why

`helm/charts/backup-status/` ships 9 manifests against an apiGroup
(`openwhisk.apache.org/v1`) that no real CRD provisions, and defaults 4 of
5 adapters to `enabled: false`. The chart cannot install on a vanilla
cluster and would do nothing if it did. From
`openspec/audit/cap-p1-helm-charts-and-kubernetes-manifests.md`:

- **B1** (`helm/charts/backup-status/templates/openwhisk-actions.yaml:1, :43,
  openwhisk-operations-actions.yaml:3, :37, :69, :88,
  openwhisk-trigger.yaml:2, openwhisk-rule.yaml:2, openwhisk-alarm.yaml:2,
  openwhisk-audit-actions.yaml:1, :30`) — `apiVersion:
  openwhisk.apache.org/v1`. Apache OpenWhisk does not ship a CRD with this
  apiGroup. `helm install` against a vanilla cluster fails with `no matches
  for kind "Action" in version "openwhisk.apache.org/v1"`.
- **B12** (`helm/charts/backup-status/values.yaml:10-17`) — `mongodb`, `s3`,
  `keycloak`, `kafka` adapters default to `enabled: false`. Only the
  postgresql adapter runs. Per the L1 audit this is the literal "4 of 5
  adapters stubbed" condition.
- **G2** restates B1 with the "decorative chart" framing.

## What Changes

- Replace the 9 CR-shaped manifests with `ConfigMap` resources carrying
  action payloads (`spec.code` + `spec.runtime` + binding env), to be
  registered via `wsk action create` from the new
  `run_one_shot_openwhisk` bootstrap step landed by
  `fix-p1-bootstrap-script-gaps`.
- Flip the four stubbed adapters to `enabled: true` by default in
  `values.yaml:10-17`, matching the L1 capability's intended scope.
- Add a chart pre-install hook that uses `lookup` to verify the OpenWhisk
  component is available in the cluster; fail render when not.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: requirement that the backup-status chart
  produces installable resources against a vanilla cluster and ships all
  five adapters enabled.

## Impact

- **Affected code**: rewrite `helm/charts/backup-status/templates/
  openwhisk-{actions,operations-actions,audit-actions,trigger,rule,alarm}
  .yaml` as ConfigMaps; modify `helm/charts/backup-status/values.yaml`.
- **Migration required**: depends on `fix-p1-bootstrap-script-gaps` for
  `run_one_shot_openwhisk` to be in place; ordering in the change PR
  description.
- **Breaking changes**: operators who silently used the chart as-is (and
  thus got nothing deployed) will now get five working adapters; intended.
