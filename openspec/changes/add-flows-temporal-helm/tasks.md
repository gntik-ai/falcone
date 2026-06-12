## 1. Chart dependency and values scaffolding

- [ ] 1.1 Add `temporal` `component-wrapper` alias dependency with `condition: temporal.enabled` to `charts/in-falcone/Chart.yaml`
- [ ] 1.2 Run `helm dependency update charts/in-falcone` to pull the dependency and update `Chart.lock`
- [ ] 1.3 Add `temporal:` top-level block to `charts/in-falcone/values.yaml` with `enabled: false`, PostgreSQL persistence config, SQL visibility config, schema-tool image, bootstrap job image, Web UI config, and per-role resource sizing defaults (frontend, history, matching, worker)
- [ ] 1.4 Add `"temporal": { "type": "object", "additionalProperties": true }` to the root `properties` object in `charts/in-falcone/values.schema.json` (do NOT add to `required` array)

## 2. Schema lifecycle job

- [ ] 2.1 Create `charts/in-falcone/templates/temporal/schema-job.yaml` as a Helm pre-install and pre-upgrade Job running `temporalio/temporal-sql-tool` to create/upgrade the `temporal` and `temporal_visibility` PostgreSQL databases and schemas
- [ ] 2.2 Set `helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded` and `backoffLimit: 3` on the schema Job
- [ ] 2.3 Add `securityContext.runAsNonRoot: true` and `securityContext.seccompProfile.type: RuntimeDefault` to the schema Job pod spec; do not pin `fsGroup`

## 3. Bootstrap job (namespaces + custom search attributes)

- [ ] 3.1 Create `charts/in-falcone/templates/temporal/bootstrap-job.yaml` as a Helm post-install and post-upgrade Job using `temporalio/admin-tools` image
- [ ] 3.2 Bootstrap Job must wait for the Temporal frontend gRPC port (7233) to be reachable (init container or retry loop) before issuing registration commands
- [ ] 3.3 Bootstrap Job registers the default Temporal namespace
- [ ] 3.4 Bootstrap Job registers custom search attributes: `tenantId` (Keyword), `workspaceId` (Keyword), `flowId` (Keyword), `flowVersion` (Keyword), `triggerType` (Keyword)
- [ ] 3.5 Set `helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded` on the bootstrap Job; add non-root security context (same as 2.3)

## 4. ClusterIP services and networking

- [ ] 4.1 Create `charts/in-falcone/templates/temporal/services.yaml` defining ClusterIP Services for Temporal frontend (7233), history (7234), matching (7235), worker (7239), and Web UI (8080); confirm no LoadBalancer or NodePort type is set
- [ ] 4.2 Create `charts/in-falcone/templates/temporal/networkpolicy.yaml` that allows inbound to port 7233 only from pods with label `app.kubernetes.io/component: flows-api` OR `app.kubernetes.io/component: flows-worker`; deny all other inbound traffic to Temporal pods; add a comment documenting the label contract with sibling changes add-flows-control-plane-api and add-flows-dsl-interpreter-worker

## 5. Pod security and OpenShift overlay

- [ ] 5.1 Ensure all Temporal Deployment pod specs render with `securityContext.runAsNonRoot: true` and `securityContext.seccompProfile.type: RuntimeDefault`; do not pin `fsGroup` in default values
- [ ] 5.2 Add `temporal:` section to `deploy/openshift/values-openshift.yaml` following the existing per-component SCC pattern: `volumePermissions.enabled: false`, `podSecurityContext.fsGroup: null`, `podSecurityContext.fsGroupChangePolicy: null`
- [ ] 5.3 Verify `helm template charts/in-falcone -f deploy/openshift/values-openshift.yaml --set temporal.enabled=true` renders no Temporal pod spec with a numeric `fsGroup`

## 6. Lint, template, and smoke validation

- [ ] 6.1 Run `helm lint charts/in-falcone` and confirm exit 0 with no schema errors for the `temporal` key
- [ ] 6.2 Run `helm template charts/in-falcone --set temporal.enabled=true` and confirm all four Temporal role Deployments, ClusterIP Services, schema Job, bootstrap Job, and NetworkPolicy render without errors
- [ ] 6.3 Run `helm template charts/in-falcone` (temporal disabled) and confirm no Temporal resources are rendered
- [ ] 6.4 Deploy to kind test cluster with `temporal.enabled=true`; verify all four Temporal role pods reach `Running` state, schema Job and bootstrap Job complete successfully, and custom search attributes are registered and queryable
- [ ] 6.5 Confirm `kubectl get svc,ingress` shows no LoadBalancer/NodePort or Ingress for any Temporal component after cluster deploy
- [ ] 6.6 Confirm Web UI is reachable at `http://localhost:8080` after `kubectl port-forward svc/<release>-temporal-web 8080:8080` and NOT accessible via the public API gateway hostname
