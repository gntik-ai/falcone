## 1. Prerequisites

- [ ] 1.1 Confirm `add-ferretdb-documentdb-engine` change is applied and the
      DocumentDB PostgreSQL Service name and port are available; record the
      `FERRETDB_POSTGRESQL_URL` value pattern in design.md D1
- [ ] 1.2 Identify the FerretDB 2.7.0 health/debug endpoint port (expected 8088
      for `/debug/healthz`); verify against the official image entrypoint or
      documentation so probe configuration is accurate

## 2. Umbrella Chart — FerretDB Gateway Deployment

- [ ] 2.1 Add `ferretdb.enabled: false` to `charts/in-falcone/values.yaml` with a
      comment noting the cutover toggle and the dependency on
      `add-ferretdb-documentdb-engine`
- [ ] 2.2 Add the `ferretdb.*` values stanza to `charts/in-falcone/values.yaml`:
      image `ghcr.io/ferretdb/ferretdb:2.7.0`, `replicaCount: 2`, resource
      requests/limits, `FERRETDB_POSTGRESQL_URL` reference, probe config, and a
      version-coupling comment linking gateway `2.7.0` to engine
      `0.107.0-ferretdb-2.7.0`
- [ ] 2.3 Create `charts/in-falcone/templates/ferretdb-deployment.yaml` gated by
      `{{ if .Values.ferretdb.enabled }}` rendering a Deployment with: the FerretDB
      container, `replicas: {{ .Values.ferretdb.replicaCount }}`, no
      `volumeClaimTemplates`, `livenessProbe` and `readinessProbe` on the debug port
      (8088) or TCP port 27017, and resource requests/limits from values
- [ ] 2.4 Create `charts/in-falcone/templates/ferretdb-service.yaml` rendering a
      ClusterIP Service exposing port 27017 with selector matching the FerretDB
      Deployment Pods; confirm no NodePort or LoadBalancer type is set

## 3. Networking — Internal-Only Enforcement

- [ ] 3.1 Run `helm template charts/in-falcone/ --set ferretdb.enabled=true` and
      verify: no Service of type NodePort or LoadBalancer, no Ingress, no Route for
      the FerretDB Service; record the ClusterIP Service name for the
      `add-ferretdb-data-access-cutover` change
- [ ] 3.2 If `networkPolicy.enabled` is a chart toggle: add a NetworkPolicy manifest
      gated by `ferretdb.enabled && networkPolicy.enabled` that allows ingress to
      port 27017 only from Falcone control-plane and CDC bridge pod selectors, and
      denies all other ingress

## 4. TLS

- [ ] 4.1 Set `FERRETDB_POSTGRESQL_URL` to include `sslmode=require` so the gateway
      connects to DocumentDB/PostgreSQL over TLS; confirm the DocumentDB Service
      exposes a TLS-capable port
- [ ] 4.2 Document in design.md D6 the decision to defer MongoDB-protocol TLS
      (gateway -> client) to a follow-on mTLS/service-mesh change; add a values
      comment in `ferretdb.tls.enabled: false` (default) with a note

## 5. Health and Readiness Probes

- [ ] 5.1 Configure `livenessProbe` on the FerretDB container: HTTP GET
      `/debug/healthz` on port 8088 (or TCP socket on port 27017 if the HTTP
      endpoint is unavailable in 2.7.0), `initialDelaySeconds: 15`,
      `periodSeconds: 10`
- [ ] 5.2 Configure `readinessProbe` on the FerretDB container with the same
      endpoint, `initialDelaySeconds: 5`, `periodSeconds: 5`, so the Pod is not
      added to the Service endpoints until the gateway can accept connections
- [ ] 5.3 Run `helm template` and confirm both probe stanzas are present in the
      rendered Deployment

## 6. OpenShift SCC Compliance

- [ ] 6.1 Add the FerretDB gateway entry to `deploy/openshift/values-openshift.yaml`
      following the MinIO pattern (lines 135-139): set
      `podSecurityContext.fsGroup: null`, `runAsNonRoot: true`, and
      `seccompProfile.type: RuntimeDefault` for the gateway Pod
- [ ] 6.2 Add the Harbor pull-secret annotation and airgap image-rewrite stanza for
      `ghcr.io/ferretdb/ferretdb` in the OpenShift overlay, matching the
      per-component pattern already present for other components
- [ ] 6.3 Run `helm template charts/in-falcone/ --values deploy/openshift/values-openshift.yaml
      --set ferretdb.enabled=true` and verify: no `fsGroup` on the FerretDB
      PodSpec, `runAsNonRoot: true` present, `seccompProfile.type: RuntimeDefault`
      present, image registry rewritten to Harbor

## 7. Version-Coupling Rule — Digest Pin + Startup Order

- [ ] 7.1 Set the FerretDB gateway image in `charts/in-falcone/values.yaml` to
      `ghcr.io/ferretdb/ferretdb:2.7.0@sha256:5706414241eb84f0515512c37b46db0f1b1eac9e5ceb7e4c2523211c184b1985`
      (tag + digest) so image drift is detected by the registry at pull time
- [ ] 7.2 Add a comment in `charts/in-falcone/values.yaml` under the
      `ferretdb.image` stanza explicitly stating: "Must match the FerretDB release
      bundled in the DocumentDB engine image
      (ghcr.io/ferretdb/postgres-documentdb:17-0.107.0-ferretdb-2.7.0).
      Wire protocol: MongoDB 7.0, maxWireVersion 21, buildInfo 7.0.77.
      STARTUP ORDER: engine must be fully initialised (CREATE EXTENSION documentdb
      + documentdb_api schema) BEFORE starting the gateway — gateway-first causes
      the first wire handshake to fail.
      Upgrade the engine first, then update this tag and digest."
- [ ] 7.3 Ensure the chart enforces startup order: the FerretDB gateway Deployment
      must have an init-container or depend on a Job/readiness gate from
      `add-ferretdb-documentdb-engine` that confirms the `documentdb_api` schema
      exists before the gateway container starts.
      ENGINE-SIDE CONTRACT (delivered by `add-ferretdb-documentdb-engine`, task 3.1):
      the engine exposes ClusterIP Service `<release>-documentdb:5432` and a
      post-install/post-upgrade hook Job `<release>-documentdb-init` that runs
      `CREATE EXTENSION documentdb` (loading `documentdb_api`). The gateway
      init-container should `pg_isready` against the Service AND
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'documentdb_api'`
      before the main container starts.
- [ ] 7.4 Verify that `helm lint charts/in-falcone/` passes with
      `ferretdb.enabled=true` and with the default (`ferretdb.enabled=false`); fix
      any lint errors

## 8. Validation

- [ ] 8.1 Run `helm lint charts/in-falcone/` with `ferretdb.enabled=true` and
      `ferretdb.enabled=false`; confirm "0 chart(s) failed" in both cases
- [ ] 8.2 Run `helm template charts/in-falcone/ --set ferretdb.enabled=true` and
      manually verify: Deployment has `replicas: 2`, no PVC, ClusterIP-only Service
      on port 27017, probes present, no SCC fields in base values
- [ ] 8.3 Deploy to local kind cluster with `ferretdb.enabled=true` and confirm all
      FerretDB Pods reach Ready and the ClusterIP Service is resolvable in-cluster
      (DEFERRED if no cluster is available; live verification is owned by the E2E
      change for this epic)
- [ ] 8.4 From a test pod, connect to the FerretDB ClusterIP on port 27017 with a
      MongoDB driver or `mongosh` and confirm the wire-protocol handshake returns
      `maxWireVersion: 21` and `buildInfo.version: "7.0.77"`; a different value
      indicates image drift (DEFERRED if no cluster is available)
- [ ] 8.5 Run `openspec validate add-ferretdb-gateway --strict` and confirm clean
      pass before marking this change ready for apply
- [ ] 8.6 Verify that design.md, proposal.md, and spec.md all carry the CRITICAL
      non-goal note: "FerretDB v2.7.0 does NOT enforce per-database role scoping;
      tenant isolation remains authoritative at the application layer
      (mongodb-data-api.mjs tenantId scoping)"; cross-reference
      `add-ferretdb-tenant-isolation-credentials` is present in all three files
- [ ] 8.7 Verify that `FERRETDB_POSTGRESQL_URL` in the chart/secret uses the
      bootstrap/superuser role and that the value is sourced from the Secret
      provisioned by `add-ferretdb-documentdb-engine`, not hardcoded in chart values
