## Why

The two stand-alone APISIX route YAMLs under `deploy/apisix/routes/` are
unloadable: one references a plugin that does not exist, one uses shell
placeholder syntax APISIX cannot expand, and one targets an upstream
namespace that disagrees with the umbrella chart. From
`openspec/audit/cap-p1-helm-charts-and-kubernetes-manifests.md`:

- **B6** (`deploy/apisix/routes/webhooks.yaml:7`) — plugin name
  `keycloak-openid` does not exist in Apache APISIX. The standard plugin is
  `openid-connect` (used correctly in `scheduling.yaml:11`). APISIX rejects
  the route with `unknown plugin`.
- **B7** (`deploy/apisix/routes/scheduling.yaml:13-14`) — `discovery:
  ${KEYCLOAK_DISCOVERY_URL}` and `client_id: ${KEYCLOAK_CLIENT_ID}` are
  shell placeholders. APISIX takes them as literal strings; no loader in this
  repo expands them.
- **B21** (`deploy/apisix/routes/scheduling.yaml:18`) — upstream is
  `scheduling-management.openwhisk.svc.cluster.local:80`. The umbrella's
  bootstrap-payload-configmap derives upstreams from `$.Release.Namespace`
  (typically `in-falcone`). If both are installed, the loose route mis-targets.
- **G5** restates B6/B7/B21; **G18** restates B21.

## What Changes

- Rewrite `deploy/apisix/routes/webhooks.yaml` to use `openid-connect` (the
  real APISIX plugin name).
- Replace `${VAR}` placeholders in `deploy/apisix/routes/scheduling.yaml`
  with Helm template syntax (`{{ .Values.identity.discoveryUrl }}` etc.)
  and move both YAMLs under `charts/in-falcone/templates/apisix-routes/`
  so they render through Helm.
- Make the upstream namespace template-derived from `Release.Namespace`,
  consistent with the umbrella's bootstrap-payload-configmap.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: requirement that all APISIX route artefacts
  use real APISIX plugin names, real template-engine variables, and
  release-namespace-derived upstream FQDNs.

## Impact

- **Affected code**: rewrite `deploy/apisix/routes/webhooks.yaml` and
  `deploy/apisix/routes/scheduling.yaml`; move both into
  `charts/in-falcone/templates/apisix-routes/`; extend
  `charts/in-falcone/values.yaml` with `identity.discoveryUrl` and
  `identity.clientId` keys.
- **Migration required**: operators previously applying the YAMLs out-of-
  band must now install them via the umbrella chart or via a `helm
  template ... | kubectl apply -f -` pipeline.
- **Breaking changes**: the standalone YAML loading path is removed;
  intended.
