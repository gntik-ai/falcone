## Context

`charts/in-falcone` is an umbrella Helm chart (`charts/in-falcone/Chart.yaml`) that uses a local `component-wrapper` sub-chart as an alias for every platform component, each guarded by a `condition: <alias>.enabled` flag. Confirmed components: `apisix`, `keycloak`, `postgresql`, `mongodb`, `kafka`, `openwhisk`, `storage`, `observability`, `controlPlane`, `controlPlaneExecutor`, `webConsole`, plus direct sub-charts `eso` and `vault`. No Temporal dependency exists today (`grep -ri temporal charts/` returns empty).

`charts/in-falcone/values.schema.json` (2020 lines) defines component entries via `"$ref": "#/definitions/component"` or `allOf` extensions. The root `required` array lists the components that must be present; optional components are NOT in `required`. The `additionalProperties: true` setting at both root and `#/definitions/component` means adding a new key will not break existing installs.

`deploy/openshift/values-openshift.yaml` establishes the SCC-compatible security pattern: `global.podSecurity.runAsNonRoot: true`, `global.podSecurity.seccompProfile.type: RuntimeDefault`, `global.podSecurity.fsGroup: null`; each stateful component then also nulls `podSecurityContext.fsGroup` and `podSecurityContext.fsGroupChangePolicy` because Helm's `mergeOverwrite` does not propagate a `null` global through the component-level default.

The upstream Temporal Helm chart (https://github.com/temporalio/helm-charts) supports pluggable persistence backends including PostgreSQL via `server.config.persistence.*` values and a `temporal-sql-tool` image for schema management.

## Goals / Non-Goals

**Goals:**
- Integrate Temporal behind `temporal.enabled` following the existing alias+condition pattern.
- Use PostgreSQL (platform instance or dedicated) for both primary persistence and SQL visibility; no Elasticsearch.
- Schema lifecycle managed by a Helm Job (temporal-sql-tool) on install and upgrade.
- Bootstrap Job registers the default namespace and five custom search attributes (`tenantId`, `workspaceId`, `flowId`, `flowVersion`, `triggerType`).
- All Services ClusterIP-only; no Ingress/Route/APISIX exposure.
- NetworkPolicy allows inbound port 7233 only from flow API and worker pods.
- Web UI deployed but accessible only via `kubectl port-forward`.
- OpenShift SCC-compatible: `runAsNonRoot: true`, `fsGroup: null`, `seccompProfile: RuntimeDefault`.
- `values.schema.json` extended; `helm lint` and `helm template` pass.
- Sizing defaults for dev/sandbox in values.yaml.

**Non-Goals:**
- Worker Deployment (add-flows-dsl-interpreter-worker, #359).
- Flow control-plane API routes (add-flows-control-plane-api, #365).
- Tenant namespace provisioning automation (#362).
- mTLS between Falcone services and Temporal (noted as hardening follow-up).
- Multi-cluster or active-active Temporal topology.

## Decisions

**Decision 1: component-wrapper alias vs. direct upstream chart dependency**
Use the same `component-wrapper` alias pattern as all other components rather than adding the upstream Temporal chart as a direct named dependency.
Rationale: keeps the upgrade surface uniform; the `component-wrapper` abstraction handles image registry rewriting (`global.imageRegistry`) and pull-secret injection, which are required for the Harbor/OpenShift airgap path (`deploy/openshift/values-openshift.yaml`). Direct upstream chart would bypass those helpers.
Alternative: add `temporalio/temporal` directly as a Chart.yaml dependency — rejected because it bypasses the image-rewrite helper and introduces a new dependency pattern.

**Decision 2: SQL visibility, no Elasticsearch**
Temporal supports two visibility backends: standard (SQL) and advanced (Elasticsearch). Use SQL visibility backed by PostgreSQL.
Rationale: Elasticsearch is not present in the platform chart; adding it would add significant resource cost. SQL visibility supports custom search attributes via `TEMPORAL_VISIBILITY_ARCHIVAL_STATE` columns when using Temporal ≥ 1.20 with the `postgresql12` plugin. The five required CSAs (`tenantId`, `workspaceId`, `flowId`, `flowVersion`, `triggerType`) fit within standard SQL visibility column cardinality.
Alternative: Elasticsearch — rejected (operator complexity, resource overhead, no existing chart integration).

**Decision 3: Schema job as a Helm pre-install/pre-upgrade Job**
Run `temporal-sql-tool` as a Helm `pre-install` and `pre-upgrade` Job with `helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded`.
Rationale: guarantees schema is ready before server pods start; hook-delete-policy keeps the namespace clean between upgrades. Consistent with how the platform bootstrap Job works in `charts/in-falcone/templates/`.
Risk: If the Job fails, the Helm release enters a failed state. Mitigation: set `backoffLimit: 3` and surface clear error messages in Job logs.

**Decision 4: Bootstrap Job as post-install/post-upgrade hook**
Register namespaces and CSAs in a `post-install,post-upgrade` Job that waits for the Temporal frontend gRPC port to be reachable before issuing registration commands.
Rationale: namespace/CSA registration requires a running Temporal cluster; post-install ensures ordering. The Job uses `temporal` CLI or the Go SDK's admin client — whichever is available in the `temporalio/admin-tools` image.

**Decision 5: NetworkPolicy label selectors**
Use `app.kubernetes.io/component: flows-api` and `app.kubernetes.io/component: flows-worker` as the allowed ingress label selectors in the NetworkPolicy.
Rationale: these labels will be set by the sibling changes (add-flows-control-plane-api, add-flows-dsl-interpreter-worker) following the chart's existing label conventions.
Risk: if sibling changes use different labels the NetworkPolicy will silently block traffic. Mitigation: document the required labels as a contract in this change's tasks.

**Decision 6: values.schema.json extension strategy**
Add `"temporal": { "type": "object", "additionalProperties": true }` to `properties` without touching the `required` array.
Rationale: `additionalProperties: true` allows the upstream Temporal chart's own sub-values to pass through without pre-defining every key, while the schema extension is enough for `helm lint` to recognise the key. The `--skip-schema-validation` quirk documented in MEMORY is a fallback for upgrades; the goal is for lint to pass without it.

## Risks / Trade-offs

- [Temporal schema-tool image availability in airgap] The `temporalio/temporal-sql-tool` image must be mirrored to Harbor for OpenShift airgap installs. Mitigation: document the image in the values comments and the runbook (#368); the `global.imageRegistry` rewrite helper covers it if the image reference flows through the component-wrapper image helper.
- [PostgreSQL schema collisions] The Temporal schema (`temporal` database or schema) must not collide with the platform schema (`in_falcone`). Mitigation: configure Temporal to use a dedicated database (`temporal` + `temporal_visibility`) distinct from the platform database.
- [NetworkPolicy label drift] If add-flows-control-plane-api or add-flows-dsl-interpreter-worker ship different `app.kubernetes.io/component` labels, flows will be blocked. Mitigation: the required labels are an explicit task item and a contract comment in the NetworkPolicy template.
- [fsGroup null propagation] As noted in `deploy/openshift/values-openshift.yaml`, setting `global.podSecurity.fsGroup: null` is not sufficient for stateful components; each Temporal pod spec must also null `podSecurityContext.fsGroup` explicitly in the OpenShift overlay. Mitigation: mirror the per-component null pattern for `temporal:` in `deploy/openshift/values-openshift.yaml`.

## Migration Plan

1. Add `temporal` dependency entry to `Chart.yaml`; run `helm dependency update charts/in-falcone`.
2. Add `temporal:` block to `values.yaml` with `enabled: false` as default.
3. Extend `values.schema.json` with the `temporal` property.
4. Add OpenShift overlay section to `deploy/openshift/values-openshift.yaml`.
5. Add templates under `charts/in-falcone/templates/temporal/`: schema Job, bootstrap Job, ClusterIP Services, NetworkPolicy.
6. `helm lint charts/in-falcone` and `helm template charts/in-falcone --set temporal.enabled=true` must pass.
7. Kind cluster smoke test: `helm upgrade --install` with `temporal.enabled=true`; verify all four Temporal role pods reach `Running` state.
8. Rollback: `helm upgrade` with `temporal.enabled=false` removes all Temporal resources; no platform downtime (other components unaffected).

## Open Questions

- Which version of the Temporal server chart / images to pin? (Depends on #356 for the minimum Temporal version that supports the required custom search attribute types on PostgreSQL.)
- Should the bootstrap Job create a single `default` namespace or also a `flows` namespace? (Depends on #356 tenancy model.)
- Are `temporal_visibility` and `temporal` databases to be created as separate PG databases, or as separate schemas within `in_falcone`? (Recommend separate databases to avoid migration coupling; confirm with #356.)
