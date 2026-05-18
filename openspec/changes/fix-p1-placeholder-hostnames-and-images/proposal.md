## Why

The Helm chart trees ship `example.com` hostnames and `ghcr.io/example`
images in their production-named values files. A default `helm install -f
values/prod.yaml` deploys a non-routable platform with images that 404. From
`openspec/audit/cap-p1-helm-charts-and-kubernetes-manifests.md`:

- **B3** (`charts/realtime-gateway/values.yaml:3, :13, :17-19`) — `tag:
  latest` and `https://keycloak.example/realms/falcone/...`.
- **B9** (`charts/in-falcone/values/prod.yaml:6-9, :66-69`) —
  `api.in-falcone.example.com`, `console.in-falcone.example.com`,
  `iam.in-falcone.example.com`, `realtime.in-falcone.example.com`.
- **B10** (`charts/in-falcone/values.yaml:2062, :2146`) — `controlPlane.image`
  and `webConsole.image` are `ghcr.io/example/in-falcone-control-plane:0.1.0`
  and `ghcr.io/example/in-falcone-web-console:0.1.0`. `ghcr.io/example` is
  not a real registry owner.
- **B14** (`helm/provisioning-orchestrator/values.yaml`) — directory has a
  values file but no `Chart.yaml`/`templates/`; nothing consumes the file.
- **G13** restates B9; **G23** restates B10.

## What Changes

- Replace every `example.com` hostname in
  `charts/in-falcone/values/prod.yaml` with `REQUIRED_<binding>_HOSTNAME`
  sentinel values; extend `templates/validate.yaml` to fail render when any
  hostname matches `.*\.example\..*`.
- Replace `ghcr.io/example/...` in `charts/in-falcone/values.yaml` with
  unset defaults; extend `validate.yaml` to require `image.repository` be
  set for `controlPlane` and `webConsole` (matches the existing per-component
  validator at `validate.yaml:6-8`).
- In `charts/realtime-gateway/values.yaml` pin `tag` to `0.1.0` and replace
  `keycloak.example` with a `realtimeGateway.identity.discoveryUrl` value
  the chart consumer MUST set.
- Delete `helm/provisioning-orchestrator/` (orphan values file with no
  chart); document any genuine consumer that needs the keys.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: requirement that no production-named values
  file may ship `example.com`/`ghcr.io/example`/`:latest`; that the
  umbrella's `validate.yaml` enforces the rule at render time.

## Impact

- **Affected code**: `charts/in-falcone/values/prod.yaml`,
  `charts/in-falcone/values.yaml`, `charts/in-falcone/templates/validate.yaml`,
  `charts/realtime-gateway/values.yaml`,
  `charts/realtime-gateway/templates/deployment.yaml`, delete
  `helm/provisioning-orchestrator/values.yaml`.
- **Migration required**: operators using `prod.yaml` defaults must supply
  real hostnames at install time; `validate.yaml` makes the requirement
  load-bearing.
- **Breaking changes**: `helm install -f values/prod.yaml` fails until
  hostnames and image references are supplied; intended.
