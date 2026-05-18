## Why

Five secondary defects in the umbrella's secret-tier, image-resolution, and
public-surface paths combine into an unsafe production posture. From
`openspec/audit/cap-p1-helm-charts-and-kubernetes-manifests.md`:

- **B22** (`charts/in-falcone/charts/vault/templates/vault-audit-sidecar.yaml`)
  — Vault audit-sidecar publishes to Kafka topic `console.secrets.audit`;
  Kafka credentials come via ESO from Vault. At first boot Vault is sealed,
  ESO has no credentials, audit-sidecar cannot publish. Boot cycle.
- **B23** (`charts/in-falcone/charts/eso/templates/eso-rbac.yaml:7-8`) — ESO
  ClusterRole grants `create, update, patch, delete` on all Secrets cluster-
  wide. Compromised controller wipes any Secret.
- **B24** (`charts/in-falcone/charts/component-wrapper/templates/_helpers.tpl
  :30-45`) — `normalise-repository` helper rewrites the registry prefix even
  for fully-qualified images. `ghcr.io/example/foo:tag` becomes
  `registry.airgap.in-falcone.local/example/foo:tag`, losing the original
  registry. Useful for airgap; dangerous when mixing registries.
- **B25** (`charts/in-falcone/templates/public-surface.yaml:59`) —
  `LoadBalancer` branch creates one Service per binding with
  `allocateLoadBalancerNodePorts: true`. Four bindings become four
  potentially-expensive cloud LBs.
- **B26** (`charts/in-falcone/templates/validate.yaml:74-76`) — checks
  `bootstrap.lock.name != markers.name`. Does not defend against marker
  rewrite via the over-broad RoleBinding (B13).
- **G10** restates B23; **G14** flags the `.local` TLD on airgap;
  **G21** restates B22; **G22** flags `validate.yaml` does not check image
  tags; **G25** flags the two parallel APISIX route paths.

## What Changes

- Defer Vault audit-sidecar startup until Kafka is reachable: add a Helm
  `post-install` Job that polls Vault `Active` + Kafka Service readiness
  before flipping the sidecar's `enabled` flag (or use an init-container
  with `kubectl wait`).
- Add a `clusterSecretStoreScope` value to the ESO subchart that lets the
  operator restrict the ClusterRole to specific namespaces; default to
  `[in-falcone, vault-escrow]` rather than `*`.
- Tighten `normalise-repository` in `_helpers.tpl:30-45` to skip the
  rewrite when `global.imageRegistry.rewriteFullyQualified` is false
  (default false); operator opts in for airgap.
- In `public-surface.yaml` add a `combineBindingsIntoSingleService` flag
  for the `LoadBalancer` branch (default true) so the four bindings share
  one LB.
- Extend `validate.yaml` to detect and reject `image.tag = latest`, and
  emit a warning when bootstrap markers and the bootstrap RoleBinding's
  resourceNames disagree (companion to
  `fix-p1-bootstrap-script-gaps`'s scoping).

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: requirement that Vault audit-sidecar starts
  only when Kafka is reachable; ESO ClusterRole is scope-narrowable;
  component-wrapper does not silently rewrite fully-qualified registries;
  LoadBalancer public-surface produces one LB by default; `validate.yaml`
  catches `:latest` and bootstrap-marker scope drift.

## Impact

- **Affected code**:
  `charts/in-falcone/charts/vault/templates/vault-audit-sidecar.yaml`,
  `charts/in-falcone/charts/eso/templates/eso-rbac.yaml`,
  `charts/in-falcone/charts/eso/values.yaml`,
  `charts/in-falcone/charts/component-wrapper/templates/_helpers.tpl`,
  `charts/in-falcone/charts/component-wrapper/values.yaml`,
  `charts/in-falcone/templates/public-surface.yaml`,
  `charts/in-falcone/templates/validate.yaml`,
  `charts/in-falcone/values.yaml`.
- **Migration required**: airgap operators currently relying on the
  fully-qualified rewrite must set
  `global.imageRegistry.rewriteFullyQualified: true`.
- **Breaking changes**: default LoadBalancer count drops from four to one;
  intended.
