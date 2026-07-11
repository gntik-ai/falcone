# Helm review — deploying Falcone to OpenShift with a private Harbor (restricted network)

Scope: `charts/in-falcone` (the product chart) + the runtime pieces added under
`deploy/kind/` (control-plane, web-console, fn-runtime, Knative functions). Goal:
is this valid for a production OpenShift install pulling **only** from the company
Harbor, with restricted egress? This is a code-grounded assessment, not a guess.

## Verdict

**The product chart is largely OpenShift/Harbor-ready by design** — it already has
the right knobs. The blockers are a handful of **OpenShift SCC** issues (root
init-containers, fixed UID/GID), the **OpenWhisk→Knative** swap (the chart still
ships an `openwhisk` component), and the fact that the **runtime pieces I added on
kind are NOT in the chart** (they live in `deploy/kind/values-kind.yaml` + standalone
manifests). None are architectural dead-ends; all are concrete, bounded changes.

**Do NOT reuse `deploy/kind/values-kind.yaml` on OpenShift** — it is kind-only
(`localhost:30500`, `bitnamilegacy/*`, hardcoded `runAsUser: 636/1000/65534`,
NodePort, bootstrap disabled, `--skip-schema-validation`). It exists to work around
a kind cluster on a futuristic kernel; it would fail or be insecure on OpenShift.
Use a new `values-openshift.yaml` driving the chart's existing `global.*` knobs
(skeleton at the end of this doc).

## Productionization status (what this pass changed)

The review's P0/P1 chart-side blockers have now been **implemented in the chart**
(`charts/in-falcone`) + the OpenShift overlay (`deploy/openshift/values-openshift.yaml`),
all re-validated by `helm lint` + `helm template` (see updated numbers below) AND
regression-deployed to kind (the kind path still renders + runs; the executor RBAC is
now chart-managed and the control-plane + a live Knative function are unaffected):

- **Control-plane runtime folded into the chart.** `controlPlane.image` →
  `ghcr.io/gntik-ai/in-falcone-control-plane` (Harbor-rewritten via `global.imageRegistry`),
  `serviceAccount.automountToken: true` by default, and a new
  `controlPlane.functionExecutor.enabled` toggle. The full data-plane env
  (`PG*`, `KEYCLOAK_*`, `MINIO_*`, `MONGO_*`, `KAFKA_BROKERS`, `FN_RUNTIME_IMAGE`,
  `ROUTE_MAP_FILE`) lives in the overlay sourced from `secretKeyRef` (no literals).
- **Executor RBAC is now a chart template** (`templates/control-plane-rbac.yaml`),
  gated on `controlPlane.functionExecutor.enabled`: a namespace-scoped Role/RoleBinding
  granting `serving.knative.dev/services` + jobs + pods/log, bound to the control-plane SA.
  This replaces the standalone `deploy/kind/control-plane/executor-rbac.yaml`.
- **OpenWhisk disabled** (`openwhisk.enabled: false`) — zero openwhisk workload objects
  render. (One inert APISIX *passthrough route* `native-openwhisk-admin` remains in the
  route catalog ConfigMap — it produces no k8s Service/Route, only a dead `/_native/openwhisk/*`
  entry pointing at the now-absent upstream; Knative invocation never uses this path.
  Cosmetic cleanup, tracked under P2.)
- **Bootstrap image now Harbor-rewritten.** `templates/bootstrap-job.yaml` routes its
  kubectl image through `component-wrapper.normalizeRepository` (closing the airgap leak)
  and normalizes pull secrets the same way the workload template does.
- **SCC fsGroup fixed.** Every component pinned `podSecurityContext.fsGroup: 1001`
  (data-plane *and* stateless), which restricted-v2 rejects. `global.podSecurity.fsGroup:null`
  is NOT enough (Helm drops nil entries during the global-table coalesce, and the
  per-component value wins via `mergeOverwrite`), so the overlay nulls fsGroup
  per-component for all nine components. The render now has **0 fixed fsGroup** — the SCC
  injects one from the namespace range.

## Validation performed (not just opinion)

`helm lint` + `helm template` against the chart with `deploy/openshift/values-openshift.yaml`:
- **Renders cleanly**: 58 objects, `helm lint` 0 failures.
- **Harbor rewrite works**: every workload image resolves to `harbor.example.com/falcone/...`
  (apisix, keycloak, postgresql, mongodb, kafka, minio, prometheus, control-plane,
  web-console, bootstrap kubectl, fn-runtime) — **zero egress leaks** to
  docker.io/quay.io/gcr.io after the fixes below.
- **OpenShift Routes emit**: 4 Routes (api, console, identity, realtime) once
  `platform.openshift.enabled: true` + `platform.network.exposureKind: Route`.
- **SCC-clean**: 0 fixed `fsGroup: 1001` and 0 fixed `runAsUser` in the render.
- **Functions**: 0 openwhisk workload objects; executor Role+RoleBinding present and
  bound to the control-plane SA (`automountServiceAccountToken: true`).

I had to FIX one chart blocker to get there (committed to the chart copy):
- **`privateRegistry.pullSecretNames` was unrenderable.** `values.schema.json` requires
  its items to be **strings**, but `component-wrapper/templates/workload.yaml` did
  `- name: {{ .name | default . }}` which **crashes on string items** ("can't evaluate
  field name in type interface {}"). With the private registry enabled (the whole point
  of a Harbor install) `validate.yaml` *requires* the field, so the chart could not
  render at all on the Harbor path. Fixed: the template now normalizes
  `imagePullSecrets` ({name} maps) + `pullSecretNames` (strings) into one string list.
- **Bootstrap image bypasses the registry rewrite.** The bootstrap job's helper image
  (`docker.io/alpine/k8s:1.32.2`) is referenced outside the component-wrapper helper, so
  `global.imageRegistry` does NOT rewrite it → an egress leak in airgap. Worked around in
  the values by pinning `bootstrap.job.image.repository` to Harbor; the chart should
  route this (and any other top-level image) through the same image helper.
- **Routes need the OpenShift switch.** `platform.openshift.enabled: true` AND
  `platform.network.exposureKind: Route` (default is `Ingress`); hostnames come from
  `publicSurface.hostnames`.

## What the chart already gets right (verified)

- **Private-registry rewriting.** `component-wrapper.normalizeRepository` rewrites
  every image's registry host to `global.imageRegistry` (keeping the path). So
  `global.imageRegistry: harbor.example.com/falcone` turns
  `docker.io/bitnami/postgresql:17` into `harbor.example.com/falcone/bitnami/postgresql:17`
  with no per-image edits. There is also `global.privateRegistry` (registry,
  `pullSecretNames`, `caBundleConfigMap`) and `global.airgap.enabled`.
- **Pull secrets.** Workloads merge `global.imagePullSecrets` +
  `global.privateRegistry.pullSecretNames` — wire the Harbor robot-account pull
  secret(s) once, globally.
- **Pod security baseline.** `global.podSecurity` (runAsNonRoot, seccomp
  RuntimeDefault) is applied pod-wide; container `securityContext` is templated.
- **OpenShift Routes are first-class.** `publicSurface.route` (+ `.tls`) exists — no
  need for NodePort/Ingress hacks; the chart can emit Routes for the gateway/console.
- **Secrets via operators.** `eso` (External Secrets) and `vault` subcharts ship with
  the chart — the right pattern for restricted clusters (no plaintext secrets in git).

## Required changes (by severity)

### P0 — OpenShift SCC (restricted-v2) will reject parts of the current values
- **Root `volumePermissions` init-containers (latent).** `values.yaml` defines
  `runAsUser: 0 / runAsGroup: 0` chown init-containers for the stateful components —
  but `volumePermissions.enabled` defaults to **false**, so they are inert by default
  (good). The rule on OpenShift: **keep `volumePermissions.enabled: false`** (restricted
  SCC forbids root, and OpenShift sets volume ownership via the namespace fsGroup
  anyway). Do not enable it to "fix" a permissions error — fix it via fsGroup/SCC instead.
- **Fixed `fsGroup: 1001`** (`global.podSecurity.fsGroup` + per-component). On
  `restricted-v2` the fsGroup must come from the namespace's allocated range
  (`openshift.io/sa.scc.supplemental-groups`); a hardcoded `1001` is typically
  rejected. Fix: leave `fsGroup` UNSET on OpenShift (let the SCC inject it), or run
  under a custom SCC that allows it. Same for any `runAsUser` — drop fixed UIDs and
  rely on `runAsNonRoot: true` + SCC-assigned UID.
- **Bitnami images & arbitrary UIDs.** Bitnami postgres/mongodb/kafka historically
  assume uid 1001. Under restricted-v2 (random uid) they can fail on
  `$HOME`/data-dir permissions. Options: (a) use Bitnami's OpenShift-compatible images
  or Red Hat-certified equivalents (Crunchy/CloudNativePG for Postgres, the Red Hat
  AMQ Streams/Strimzi for Kafka — note this cluster already runs `strimzi-system` and
  `cnpg-system` operators), or (b) grant the data-plane SAs the `nonroot-v2` SCC, or
  (c) run the stateful data plane via OpenShift Operators instead of in-chart Bitnami.
  This is the single biggest decision for the OpenShift target.

### P0 — Functions: replace OpenWhisk with Knative / OpenShift Serverless
- The chart still ships an **`openwhisk`** component (`docker.io/apache/openwhisk-controller`).
  It is unused after the migration and (as proven on kind) its init tooling is fragile.
  **Remove/disable the `openwhisk` component.**
- On OpenShift, install **OpenShift Serverless** (the supported Knative) via its
  Operator + a `KnativeServing` CR (it ships Kourier). Do NOT hand-apply the upstream
  `serving-core.yaml`/`kourier.yaml` (that was the kind path). No
  `registries-skipping-tag-resolving` hack is needed — Harbor is reachable by both the
  kubelet and the Knative controller, so digest resolution works.
- Ship the **`fn-runtime`** image (`deploy/kind/fn-runtime/`) to Harbor and set
  `FN_RUNTIME_IMAGE` to its Harbor path. Add the function-executor **RBAC**
  (`deploy/kind/control-plane/executor-rbac.yaml`: `serving.knative.dev/services` +
  jobs/pods) to the chart as a templated Role/RoleBinding, and set the control-plane
  `serviceAccount.automountToken: true` (the executor calls the k8s API with the SA
  token). On OpenShift the executor-created ksvc pods get a random uid — `fn-runtime`
  is built `runAsNonRoot` with no fixed uid, so it is arbitrary-uid safe (verify the
  `/app` dir is group-readable; node:22-alpine is fine).

### P1 — The runtime I added must become part of the chart (today it is kind-only)
- **Real images for control-plane & web-console.** The chart points at
  `ghcr.io/example/in-falcone-{control-plane,web-console}` placeholders. Build the real
  images (`deploy/kind/control-plane/`, `deploy/kind/web-console/`) and push to Harbor;
  set their repositories/tags (or rely on `global.imageRegistry` + a sane default path).
- **Control-plane env + data-plane wiring.** All the env I added on kind
  (`PG*`, `KEYCLOAK_*`, `MINIO_*`, `MONGO_*`, `KAFKA_BROKERS`, `FN_RUNTIME_IMAGE`,
  `ROUTE_MAP_FILE`) must be templated into the chart's control-plane component (sourced
  from ESO/Vault-provided secrets, not literals).
- **Schema/secret bootstrap.** The chart's `values.schema.json` rejects
  `bootstrap.oneShot.keycloak.realm.login: null` (I had to `--skip-schema-validation`
  on kind). For prod, fix the schema or the value so the install validates cleanly. The
  bootstrap's APISIX *reconcile* phase assumes the APISIX Admin API; reconcile vs the
  `APISIX_STAND_ALONE` profile must be reconciled (use the Admin API on OpenShift, or
  keep routes config-driven and disable reconcile).

### P1 — Exposure & TLS
- Use `publicSurface.route` (+ TLS, edge/reencrypt) to expose the APISIX gateway (which
  fronts both the console SPA and `/v1/*`). Map the console hostname + Keycloak issuer
  (`KC_HOSTNAME`) to the Route hostnames — on kind the Keycloak issuer was left as the
  in-pod URL (fine for internal, wrong for browser OIDC); on OpenShift set `KC_HOSTNAME`
  to the public Route.

### P2 — Hygiene
- `global.defaultStorageClass`: set to the OpenShift default (e.g. the CSI SC) instead
  of kind's `standard`/local-path.
- Pin all images by **digest** (Harbor supports it) for air-gapped reproducibility; the
  image helper already supports `image.digest`.
- Add NetworkPolicies if the cluster enforces default-deny egress (control-plane →
  Postgres/Keycloak/MinIO/Mongo/Kafka/k8s-API/ksvc).

## Image mirror list for Harbor (everything the install pulls)

Product chart components:
`docker.io/apache/apisix`, `quay.io/keycloak/keycloak`,
`docker.io/bitnamilegacy/postgresql`, `docker.io/bitnamilegacy/kafka`,
`docker.io/alpine/k8s`, `docker.io/prom/prometheus`, `docker.io/library/busybox`,
and the Falcone app images (control-plane, executor, web-console, workflow-worker,
function runtime, MCP runtime).

Functions / Knative (if self-managing rather than the Operator):
`gcr.io/knative-releases/knative.dev/serving/cmd/{controller,autoscaler,activator,webhook,queue}`,
`gcr.io/knative-releases/knative.dev/net-kourier/cmd/kourier`, `docker.io/envoyproxy/envoy`,
plus the **`fn-runtime`** image. On OpenShift Serverless these come from Red Hat's
registry via the Operator — only `fn-runtime` is yours to mirror.

> Bitnami note: Bitnami purged many public Docker Hub tags (which is why kind uses
> `bitnamilegacy/*`). For a supported OpenShift install prefer Red Hat-certified data
> services (operators already present on this cluster: Strimzi for Kafka, CloudNativePG
> for Postgres) or a maintained Bitnami source, mirrored into Harbor.

## Bottom line

Migrating functions to Knative is **done and proven on kind**, and it is the *better*
fit for OpenShift (OpenShift Serverless is the supported, Operator-managed Knative).
The chart's image/registry/secret/route architecture is sound for Harbor + restricted
networking. The work to productionize is well-scoped: an OpenShift values file, the SCC
fixes (disable root volumePermissions, drop fixed UID/GID), swap the OpenWhisk component
for OpenShift Serverless, fold the new runtime (images + env + executor RBAC) into the
chart, and mirror the image set into Harbor.
