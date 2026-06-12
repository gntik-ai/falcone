## Why

Falcone has no workflow engine today; the `workflows` capability does not exist in the chart or codebase. The Temporal server must be embedded in the `charts/in-falcone` umbrella chart so that the upcoming flow DSL interpreter worker (add-flows-dsl-interpreter-worker) and flow API (add-flows-control-plane-api) have a durable execution backend without any tenant-facing exposure.

## What Changes

- New `component-wrapper`-aliased dependency `temporal` added to `charts/in-falcone/Chart.yaml` with `condition: temporal.enabled`, following the same alias+condition pattern already used by `apisix`, `keycloak`, `postgresql`, `kafka`, `mongodb`, `storage`, `observability`, `controlPlane`, and `controlPlaneExecutor`.
- New `temporal` block added to `charts/in-falcone/values.yaml` covering: `enabled` flag, PostgreSQL persistence config, SQL visibility config (no Elasticsearch), schema-tool image, bootstrap job image, service sizing defaults, and Web UI access mode.
- `charts/in-falcone/values.schema.json` extended with a `temporal` top-level property (type object, `additionalProperties: true` to remain compatible with `--skip-schema-validation` upgrade path); required array NOT extended (optional component).
- Helm templates added for: schema-setup/upgrade Job (temporal-sql-tool), bootstrap Job (register namespaces + custom search attributes: `tenantId`, `workspaceId`, `flowId`, `flowVersion`, `triggerType`), ClusterIP-only Services for frontend/history/matching/worker Temporal roles, NetworkPolicy restricting inbound to flow API + worker pods only, and a non-root/SCC-compatible security overlay.
- `deploy/openshift/values-openshift.yaml` extended with a `temporal:` section following existing conventions: `volumePermissions.enabled: false`, `podSecurityContext.fsGroup: null`, `podSecurityContext.fsGroupChangePolicy: null`, `seccompProfile.type: RuntimeDefault`.
- No APISIX route, Ingress, or OpenShift Route created for any Temporal component; Web UI accessible only via `kubectl port-forward`.

## Capabilities

### New Capabilities
- `workflows`: Temporal server deployment as an internal platform component — covers chart integration, PostgreSQL persistence + SQL visibility, schema lifecycle jobs, bootstrap namespace + search-attribute registration, ClusterIP-only networking + NetworkPolicy, OpenShift SCC-compatible security overlay, values.schema.json extension, and operator-only Web UI access.

### Modified Capabilities

## Impact

- `charts/in-falcone/Chart.yaml` — new dependency entry.
- `charts/in-falcone/values.yaml` — new `temporal.*` block.
- `charts/in-falcone/values.schema.json` — new `temporal` property; `helm lint` and template render must pass after the extension.
- `deploy/openshift/values-openshift.yaml` — new `temporal:` section.
- New chart templates under `charts/in-falcone/templates/temporal/` (Jobs, NetworkPolicy, any ClusterRole if needed).
- Sibling changes blocked until this lands: #359 (worker), #365 (flow API mediation), #367 (tenancy enforcement).
- Depends on #356 (tenancy model, namespace bootstrap inputs, custom search attribute list).
