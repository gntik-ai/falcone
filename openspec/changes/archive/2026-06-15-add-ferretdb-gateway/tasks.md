> ARCHITECTURE NOTE (code-verified): the umbrella chart renders every component via the
> `component-wrapper` sub-chart (Chart.yaml alias + values stanza), NOT hand-written
> Deployment/Service templates. FerretDB is stateless, which is exactly the wrapper's
> default (`workload.kind: Deployment`). So the Deployment + ClusterIP Service +
> ServiceAccount are wrapper-rendered; the engine-gate init-container is delivered via
> `ferretdb.initContainers` values; only the NetworkPolicy is a hand-written umbrella
> template (precedent: `seaweedfs-networkpolicy.yaml`). Adding the alias requires the
> 4-place component-alias contract sync (same as the merged documentdb change). The
> wrapper reads `replicas` (not `replicaCount`).

## 1. Prerequisites

- [x] 1.1 `add-ferretdb-documentdb-engine` is merged; engine Service is
      `in-falcone-documentdb:5432`, target DB `in_falcone`. The gateway backend DSN
      pattern is `postgres://<bootstrap-user>:<pass>@in-falcone-documentdb:5432/in_falcone?sslmode=require`,
      delivered via the `in-falcone-ferretdb` Secret key `postgresql-url` (not hardcoded).
- [x] 1.2 FerretDB debug/health endpoint configured as `/debug/healthz` on port 8088,
      with `FERRETDB_DEBUG_ADDR=:8088` so the kubelet probe can reach it (default binds
      127.0.0.1). Exact path/port is a LIVE verification — DEFERRED (no container runtime
      here; same deferral as 8.3/8.4). Probe config is values-overridable if it differs.

## 2. Umbrella Chart — FerretDB Gateway (component-wrapper alias)

- [x] 2.1 Added `ferretdb.enabled: false` to `charts/in-falcone/values.yaml` with a
      cutover comment and the dependency-on-documentdb / version-coupling notes.
- [x] 2.2 Added the `ferretdb.*` values stanza: image
      `ghcr.io/ferretdb/ferretdb:2.7.0` (+digest), `replicas: 2` (wrapper key; NOT
      `replicaCount`), resource requests/limits, `FERRETDB_POSTGRESQL_URL` via
      secretKeyRef, probe config, version-coupling comment.
- [x] 2.3 Deployment is rendered by the `component-wrapper` sub-chart (NOT a bespoke
      `templates/ferretdb-deployment.yaml`): `replicas: 2`, no PVC (persistence.enabled
      false), liveness+readiness probes on the debug port (8088), resources from values,
      and the engine-gate `wait-for-documentdb` initContainer.
- [x] 2.4 Service is rendered by the wrapper (`service.type: ClusterIP`, port 27017,
      selector on the ferretdb pod labels); no NodePort/LoadBalancer.

## 3. Networking — Internal-Only Enforcement

- [x] 3.1 `helm template --set ferretdb.enabled=true` verified: no NodePort/LoadBalancer
      Service, no Ingress, no Route for ferretdb. ClusterIP Service name for the cutover
      change is `<release>-ferretdb:27017` (e.g. `in-falcone-ferretdb`).
- [x] 3.2 Added `templates/ferretdb-networkpolicy.yaml` gated by
      `ferretdb.enabled && ferretdb.networkPolicy.enabled` (default on when enabled):
      ingress to 27017 only from `ferretdb.networkPolicy.allowedAppComponents`
      (control-plane / control-plane-executor / workflow-worker) + intra-ferretdb; egress
      DNS + platform namespace (reaches the engine). CNI-enforcement caveat documented.

## 4. TLS

- [x] 4.1 Backend TLS via `sslmode=require` is carried inside the `FERRETDB_POSTGRESQL_URL`
      Secret value (documented in the values comment + design D6); the DocumentDB Service
      is a standard Postgres endpoint that honors sslmode.
- [x] 4.2 MongoDB-protocol (gateway->client) TLS deferred to a follow-on mTLS/service-mesh
      change; `ferretdb.tls.enabled: false` (default) added with a note (design D6).

## 5. Health and Readiness Probes

- [x] 5.1 `livenessProbe`: HTTP GET `/debug/healthz` on 8088, initialDelaySeconds 15,
      periodSeconds 10.
- [x] 5.2 `readinessProbe`: same endpoint, initialDelaySeconds 5, periodSeconds 5, so the
      pod is excluded from Service endpoints until it can serve.
- [x] 5.3 `helm template` confirms both probe stanzas render on the Deployment.

## 6. OpenShift SCC Compliance

- [x] 6.1 Added the `ferretdb` block to `deploy/openshift/values-openshift.yaml`:
      `podSecurityContext.fsGroup: null` + `fsGroupChangePolicy: null` (stateless; SCC
      injects). `runAsNonRoot: true` + `seccompProfile.type: RuntimeDefault` come from
      `global.podSecurity`. FerretDB image is non-root → no `runAsUser` (design D5).
- [x] 6.2 Harbor/airgap rewrite of the main container image is AUTOMATIC via
      `global.imageRegistry` + the wrapper's normalizeRepository (verified: image renders
      as `harbor.example.com/falcone/ferretdb/ferretdb@<digest>`). NOTE recorded: the
      engine-gate initContainer image is NOT auto-rewritten — mirror it alongside the
      engine image.
- [x] 6.3 `helm template --values deploy/openshift/values-openshift.yaml --set
      ferretdb.enabled=true` verified: no non-null fsGroup, runAsNonRoot true,
      seccompProfile RuntimeDefault, image rewritten to Harbor.

## 7. Version-Coupling Rule — Digest Pin + Startup Order

- [x] 7.1 Gateway image pinned by tag + digest
      (`ghcr.io/ferretdb/ferretdb:2.7.0@sha256:5706…`); rendered Deployment uses the
      digest form so drift is caught at pull time.
- [x] 7.2 Version-coupling + engine-first UPGRADE-ORDER comment present in
      `charts/in-falcone/values.yaml` under the `ferretdb` stanza (links gateway 2.7.0 to
      engine 0.107.0-ferretdb-2.7.0; wire protocol 7.0 / maxWireVersion 21 / 7.0.77).
- [x] 7.3 Startup order enforced: the `wait-for-documentdb` initContainer runs
      `pg_isready` against `in-falcone-documentdb:5432` AND blocks until
      `information_schema.schemata` shows `documentdb_api` (created by the engine's
      CREATE EXTENSION init Job) before the gateway container starts. The readiness probe
      is the secondary gate.
- [x] 7.4 `helm lint` passes with `ferretdb.enabled=true` and the default
      (`ferretdb.enabled=false`).

## 8. Validation

- [x] 8.1 `helm lint` with `ferretdb.enabled=true` and `=false`: "0 chart(s) failed" both.
- [x] 8.2 `helm template --set ferretdb.enabled=true` verified: Deployment `replicas: 2`,
      no PVC, ClusterIP-only Service on 27017, probes present, no SCC fields in base values
      (only inherited global.podSecurity).
- [x] 8.3 Live kind deploy (Pods Ready, Service resolvable) DEFERRED — no cluster here;
      live verification owned by the epic's E2E change.
- [x] 8.4 Live `mongosh`/driver handshake (maxWireVersion 21, buildInfo 7.0.77) DEFERRED —
      same reason as 8.3.
- [x] 8.5 `openspec validate add-ferretdb-gateway --strict` passes.
- [x] 8.6 The CRITICAL non-goal note (FerretDB v2.7.0 does NOT enforce per-database role
      scoping; application-layer `mongodb-data-api.mjs` tenantId scoping is authoritative)
      is present in proposal.md, design.md, and spec.md, with the
      `add-ferretdb-tenant-isolation-credentials` cross-reference.
- [x] 8.7 `FERRETDB_POSTGRESQL_URL` is sourced from the `in-falcone-ferretdb` Secret
      (bootstrap/superuser DSN), not hardcoded in chart values. (Reconciliation: the
      engine change references an external admin Secret rather than provisioning one, so
      the gateway uses a dedicated externally-provisioned DSN Secret, same pattern.)
