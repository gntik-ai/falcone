## 1. Chart integration and values scaffolding

- [x] 1.1 (DEVIATION — see design.md Decision 1) Render Temporal via first-class umbrella templates under `charts/in-falcone/templates/temporal/**` gated by `temporal.enabled`, NOT a `component-wrapper` alias (the wrapper renders only one Deployment+Service per alias, which cannot express four role Deployments + Web UI + two Jobs + NetworkPolicy). Added `in-falcone.temporal.*` helpers to `templates/_helpers.tpl`; image refs reuse the shared `component-wrapper.normalizeRepository` helper for Harbor rewrite.
- [x] 1.2 No new `Chart.yaml` dependency is added, so `Chart.lock` is unchanged and `helm dependency update` is not required (all existing deps are local `file://` charts, status `unpacked`). Verified with `helm dependency list charts/in-falcone`.
- [x] 1.3 Add `temporal:` top-level block to `charts/in-falcone/values.yaml` with `enabled: false`, PostgreSQL persistence config, SQL visibility config, schema-tool image, bootstrap job image, Web UI config, and per-role resource sizing defaults (frontend, history, matching, worker)
- [x] 1.4 Add `"temporal": { "type": "object", "additionalProperties": true }` to the root `properties` object in `charts/in-falcone/values.schema.json` (do NOT add to `required` array)

## 2. Schema lifecycle job

- [x] 2.1 Create `charts/in-falcone/templates/temporal/schema-job.yaml` as a Helm pre-install and pre-upgrade Job running `temporal-sql-tool` (bundled in the `temporalio/admin-tools` image) to create/upgrade the `temporal` and `temporal_visibility` PostgreSQL databases and schemas
- [x] 2.2 Set `helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded` and `backoffLimit: 3` on the schema Job
- [x] 2.3 Add `securityContext.runAsNonRoot: true` and `securityContext.seccompProfile.type: RuntimeDefault` to the schema Job pod spec; do not pin `fsGroup`

## 3. Bootstrap job (namespaces + custom search attributes)

- [x] 3.1 Create `charts/in-falcone/templates/temporal/bootstrap-job.yaml` as a Helm post-install and post-upgrade Job using `temporalio/admin-tools` image
- [x] 3.2 Bootstrap Job must wait for the Temporal frontend gRPC port (7233) to be reachable (retry loop on `temporal operator cluster health`) before issuing registration commands
- [x] 3.3 Bootstrap Job registers the default Temporal namespace (`temporal.bootstrap.namespace`, default `falcone-flows`)
- [x] 3.4 Bootstrap Job registers custom search attributes: `tenantId` (Keyword), `workspaceId` (Keyword), `flowId` (Keyword), `flowVersion` (Keyword), `triggerType` (Keyword)
- [x] 3.5 Set `helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded` on the bootstrap Job; add non-root security context (same as 2.3)

## 4. ClusterIP services and networking

- [x] 4.1 Create `charts/in-falcone/templates/temporal/services.yaml` defining ClusterIP Services for Temporal frontend (7233), history (7234), matching (7235), worker (7239), and Web UI (8080); confirm no LoadBalancer or NodePort type is set
- [x] 4.2 Create `charts/in-falcone/templates/temporal/networkpolicy.yaml` that allows inbound to port 7233 only from pods with label `app.kubernetes.io/component: flows-api` OR `app.kubernetes.io/component: flows-worker`; deny all other inbound traffic to Temporal frontend pods; comment documents the label contract with sibling changes add-flows-control-plane-api and add-flows-dsl-interpreter-worker

## 5. Pod security and OpenShift overlay

- [x] 5.1 Ensure all Temporal Deployment pod specs render with `securityContext.runAsNonRoot: true` and `securityContext.seccompProfile.type: RuntimeDefault`; do not pin `fsGroup` in default values (Temporal pods are stateless — `temporal.podSecurityContext` omits `fsGroup` entirely)
- [x] 5.2 Add `temporal:` section to `deploy/openshift/values-openshift.yaml` following the existing per-component SCC pattern: `podSecurityContext.fsGroup: null`, `podSecurityContext.fsGroupChangePolicy: null` (plus explicit `runAsNonRoot`/`seccompProfile`). `volumePermissions` is N/A — Temporal has no PVC.
- [x] 5.3 Verify `helm template charts/in-falcone -f deploy/openshift/values-openshift.yaml --set temporal.enabled=true` renders no Temporal pod spec with a numeric `fsGroup`

## 6. Lint, template, and smoke validation

- [x] 6.1 Run `helm lint charts/in-falcone` and confirm exit 0 with no schema errors for the `temporal` key
- [x] 6.2 Run `helm template charts/in-falcone --set temporal.enabled=true` and confirm all four Temporal role Deployments, ClusterIP Services, schema Job, bootstrap Job, and NetworkPolicy render without errors
- [x] 6.3 Run `helm template charts/in-falcone` (temporal disabled) and confirm no Temporal resources are rendered
- [x] 6.4 Deploy to kind test cluster with `temporal.enabled=true`; verified all four Temporal role pods (frontend/history/matching/worker) + Web UI reach `Running` (1/1, 0 restarts), the pre-install schema Job and post-install bootstrap Job both completed (`helm install` exit 0; release `deployed`), the `falcone-flows` namespace is registered and queryable, and all five custom search attributes (`tenantId`, `workspaceId`, `flowId`, `flowVersion`, `triggerType`) are registered as `Keyword` and queryable via `temporal operator search-attribute list`.
- [x] 6.5 Confirmed `kubectl get svc,ingress` shows all five Temporal Services as `ClusterIP` (no LoadBalancer/NodePort anywhere in the namespace) and no Temporal Ingress/Route (no Route CRD on the cluster).
- [x] 6.6 Confirmed the Web UI returns HTTP 200 via `kubectl port-forward svc/flows-temporal-web 18080:8080`, and is NOT accessible via the public API gateway: the public Ingress routes only api/console/iam/realtime to placeholder backends with zero reference to any Temporal service; `temporal-web` is ClusterIP-only.
