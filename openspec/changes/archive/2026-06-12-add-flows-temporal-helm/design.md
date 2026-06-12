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

**Decision 1: first-class umbrella templates vs. component-wrapper alias (IMPLEMENTATION DEVIATION)**
Render Temporal via purpose-built umbrella templates under `charts/in-falcone/templates/temporal/**`, gated by `temporal.enabled`, rather than as a `component-wrapper` alias dependency in `Chart.yaml`.
Rationale for the deviation from the original sketch: the shared `component-wrapper` sub-chart (`charts/in-falcone/charts/component-wrapper/templates/workload.yaml`) renders **exactly one Deployment + one Service per release alias**. Temporal is a four-role server (frontend / history / matching / worker) plus a Web UI, two lifecycle Jobs (schema + bootstrap), five Services, and a NetworkPolicy — it cannot be expressed by a single component-wrapper alias. Adding a `temporal` alias would also emit a stray generic Deployment/Service that conflicts with the role workloads. The umbrella already ships first-class templates for multi-resource concerns (e.g. `templates/bootstrap-job.yaml`, `templates/bootstrap-*-configmap.yaml`), so Temporal follows that established pattern. Image references still flow through the shared `component-wrapper.normalizeRepository` helper (via the new `in-falcone.temporal.image` helper), so `global.imageRegistry` (Harbor) rewriting and the airgap path keep working — the helper is reused exactly as `templates/bootstrap-job.yaml` reuses it. **No new dependency is added to `Chart.yaml`; `Chart.lock` is unchanged** (all existing dependencies remain local `file://` charts).
Alternative considered: a single `component-wrapper` alias — rejected because it physically cannot render four distinct role Deployments with per-role ports/SERVICES env, two Jobs, and a NetworkPolicy.
Alternative considered: the upstream `temporalio/temporal` chart as a direct Chart.yaml dependency — rejected because it bypasses the `global.imageRegistry` image-rewrite helper and introduces a new (non-uniform) dependency/upgrade pattern.

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

1. (Deviation — no Chart.yaml dependency, see Decision 1.) Add the Temporal helpers to `templates/_helpers.tpl` and the first-class templates under `templates/temporal/**`; `Chart.lock` is unchanged.
2. Add `temporal:` block to `values.yaml` with `enabled: false` as default.
3. Extend `values.schema.json` with the `temporal` property.
4. Add OpenShift overlay section to `deploy/openshift/values-openshift.yaml`.
5. Add templates under `charts/in-falcone/templates/temporal/`: schema Job, bootstrap Job, ClusterIP Services, NetworkPolicy.
6. `helm lint charts/in-falcone` and `helm template charts/in-falcone --set temporal.enabled=true` must pass.
7. Kind cluster smoke test: `helm upgrade --install` with `temporal.enabled=true`; verify all four Temporal role pods reach `Running` state.
8. Rollback: `helm upgrade` with `temporal.enabled=false` removes all Temporal resources; no platform downtime (other components unaffected).

## Kind deploy findings (implementation notes from the smoke test)

The kind smoke test (3-node test-cluster-b, helm v4.1.4, temporal-only minimal install against a tiny in-namespace PostgreSQL) surfaced several real constraints that shaped the templates:

1. **Image tags.** The spike's `auto-setup:1.25.2` per-component tags (`server`/`admin-tools`/`ui` 1.25.2) are no longer on Docker Hub. Pinned to available, aligned tags: `temporalio/server:1.31.1`, `temporalio/admin-tools:1.31.1` (bundles both `temporal-sql-tool` and the `temporal` CLI), `temporalio/ui:2.51.0`.
2. **Plain `server` image, not `auto-setup`.** Used `temporalio/server` with one Deployment per role (`SERVICES`/`TEMPORAL_SERVICES` selects the role). It does NOT auto-render config from env vars (that is an auto-setup/dockerize feature), so the config ConfigMap is rendered from Helm values, and the per-pod broadcast/bind IP is substituted from `POD_IP` by a small `sh` start wrapper.
3. **`/bin/sh` only.** The admin-tools image is alpine-based and ships `/bin/sh` (no bash); the schema + bootstrap Jobs are POSIX-sh. `temporal-sql-tool` has no `ping` subcommand — connectivity is probed via an idempotent `create-database` against the `postgres` DB.
4. **IPv4 bind.** A `bindOnIP: 0.0.0.0` makes the Go gRPC server listen on the IPv6 wildcard `[::]`, which this CNI does not route to IPv4 clients/Service. Binding the concrete IPv4 pod IP (substituted into `bindOnIP` + `BIND_ON_IP`) yields a reachable IPv4 listener.
5. **NetworkPolicy must admit Temporal's own internals.** The frontend NetworkPolicy (port 7233) blocks everything except the allowed labels. The Temporal **worker role** (embeds an SDK client) and the **bootstrap Job** both connect to 7233 and were being blocked → added an ingress rule admitting `in-falcone.io/component: temporal` (every Temporal pod, incl. the Jobs). This is required for the deployment to be functional standalone.
6. **Worker startup ordering.** The worker role crashes on a hard fx deadline if the frontend is not yet SERVING, which also pollutes `cluster_membership` on restart. Added a `wait-for-frontend` init container (admin-tools, gated on `cluster health`) to the worker Deployment only.
7. **Bootstrap SA registration is retried.** A freshly-created namespace can briefly reject search-attribute registration; the bootstrap now retries each attribute until it is listed (instead of fire-and-forget), guaranteeing all five CSAs land.

Verified: all four role pods + Web UI Running (0 restarts), schema + bootstrap hooks completed (`helm install` exit 0), `falcone-flows` namespace + all five Keyword CSAs registered and queryable, all Services ClusterIP, no Ingress/Route/LB/NodePort for Temporal, Web UI HTTP 200 via port-forward only.

## Open Questions

- Which version of the Temporal server chart / images to pin? RESOLVED for the kind smoke test: `server`/`admin-tools` `1.31.1`, `ui` `2.51.0` (the older per-component tags were pruned from Docker Hub). Operators may pin a different supported release via `temporal.image.tag` etc.
- Should the bootstrap Job create a single `default` namespace or also a `flows` namespace? RESOLVED (ADR-11): a single shared namespace, default `falcone-flows` (`temporal.bootstrap.namespace`).
- Are `temporal_visibility` and `temporal` databases to be created as separate PG databases, or as separate schemas within `in_falcone`? RESOLVED: separate databases (`temporal` + `temporal_visibility`), distinct from the platform `in_falcone` DB, to avoid migration coupling.
