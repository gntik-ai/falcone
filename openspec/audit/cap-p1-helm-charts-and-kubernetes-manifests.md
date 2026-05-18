# Capability P1 — Helm Charts & Kubernetes Manifests

**Source locus.** Three parallel chart trees plus loose deploy artefacts:

| Tree | Path | Files | LOC |
|---|---|---|---|
| Umbrella (well-engineered) | `charts/in-falcone/` | 60 | 5,452 |
| Sidecar charts (ad-hoc) | `charts/realtime-gateway/` + `charts/workspace-docs-service/` | 9 | ~210 |
| OpenWhisk-style chart | `helm/charts/backup-status/` | 8 | 540 |
| Values-only stub | `helm/provisioning-orchestrator/` | 1 | 13 |
| Loose values files for absent charts | `deploy/helm/` | 2 | 52 |
| Loose APISIX routes | `deploy/apisix/routes/` | 2 | 36 |
| Stand-alone K8s manifest | `deploy/k8s/encryption-config.yaml` | 1 | 16 |

**Method.** Delegated three parallel Explore agents for the bulk: `charts/in-falcone/values.yaml` (3 039 LOC), `templates/bootstrap-script-configmap.yaml` (427 LOC), and the entire Vault subchart (~330 LOC across 12 files). Read everything else (33 files, ~2 100 LOC) directly. Spot-verified every damaging subagent claim against the live source. Cross-referenced findings against the prior capability audits — F2 (realtime-gateway "image source out of repo, no Service template"), F3 (webhook engine production-defaults), I1 (scheduling engine SQL injection), L1 (backup-status `openwhisk.apache.org/v1` chart), N1 (APISIX gateway), B1 (Keycloak realm/scope bootstrap).

**Scope note.** P1 as defined in the capability map is "Helm charts & Kubernetes manifests". In practice it is **the only repo-resident deployment surface for the entire Falcone platform** — every other capability assumes "Helm install does the right thing". The audit reveals that "Helm install" actually means *one* well-engineered umbrella chart plus *four* unconnected chart trees and three loose YAMLs, of which several install resources backed by CRDs that are not provisioned anywhere in this repo.

---

## SPEC (what exists)

### S1. The umbrella chart (`charts/in-falcone/`)

- **WHEN** the chart `in-falcone` v0.3.0 is installed, **THE SYSTEM SHALL** evaluate `templates/validate.yaml` first (`validate.yaml:100`), failing the render if any of 30 cross-component invariants is violated — image-repository presence per enabled component, persistence size when not using existing claim, airgap registry constraint, exposure-kind ∈ {Ingress, LoadBalancer, Route}, OpenShift ⇒ Route, LoadBalancer ⇒ TLS=external, profile in supported set, public-surface bindings reachable, `gatewayPolicy.oidc.enabled === true`, `gatewayPolicy.passthrough.mode ∈ {enabled, limited, disabled}`, claims-stripping enforced, CORS allow-headers non-empty, correlation auto-generation enabled, error-envelope schema fixed, spoofed-header list non-empty, QoS profile catalogue non-empty, internal-request required-headers non-empty, bootstrap lock ≠ marker name, bootstrap ⇒ keycloak+apisix enabled, bootstrap secret sources non-empty, upgrade ⇒ currentVersion declared and in supported list, no implicit downgrade (`validate.yaml:1-99`).
- **WHEN** rendered, **THE SYSTEM SHALL** instantiate the `component-wrapper` subchart 10 times — once per backing component (`apisix, keycloak, postgresql, mongodb, kafka, openwhisk, storage, observability, controlPlane, webConsole`) — each gated on `.enabled` (`Chart.yaml:7-57`).
- **WHEN** `bootstrap.enabled=true`, **THE SYSTEM SHALL** install a post-install/post-upgrade Helm hook Job (`bootstrap-job.yaml:11-12`, weight `10`, `before-hook-creation` delete-policy) that mounts `bootstrap-script-configmap` (`mode 0755`) and `bootstrap-payload-configmap` as read-only volumes, plus an emptyDir at `/tmp`; env carries injected `KubernetesSecret` references from `bootstrap.secretResolution.sources` (`bootstrap-job.yaml:60-68`).
- **WHEN** the bootstrap script runs, **THE SYSTEM SHALL** acquire an EXIT-trap-released lock ConfigMap (`bootstrap-script-configmap.yaml:49-64`), exit unless `BREAK_GLASS_EXISTING_LOCK=true` if the lock exists, compare `ONE_SHOT_HASH` (computed from `keycloak`/`governanceCatalog`/`internalNamespaces` SHA-256 via `_helpers.tpl:72-74`) against the prior marker (`bootstrap-script-configmap.yaml:411-418`); if differing run `run_one_shot_bootstrap` then write the marker; always run `run_upgrade_reconciliation` to PUT every APISIX route to `/apisix/admin/routes/$routeId`.
- **WHEN** `run_one_shot_bootstrap` runs, **THE SYSTEM SHALL** create the Keycloak realm + every `role-*.json`, `client-scope-*.json`, `client-*.json` from the payload ConfigMap, then create the superadmin user and assign the `superadmin` realm role (`bootstrap-script-configmap.yaml:354-393`).
- **WHEN** each bootstrap mutation runs, **THE SYSTEM SHALL** treat HTTP {200, 201, 204, 409} as success and HTTP 200/listing-hit as "already exists / skip" (idempotent across reinstalls).
- **WHEN** `validate.yaml` accepts the values, **THE SYSTEM SHALL** render `runtime-configmaps.yaml` to emit three runtime ConfigMaps (`gateway`, `controlPlane`, `webConsole`) carrying claim-propagation header names, OIDC discovery URLs, passthrough mode, gateway-metrics path, and per-environment log/debug toggles (`runtime-configmaps.yaml:1-66`).
- **WHEN** `platform.network.exposureKind` is Ingress/LoadBalancer/Route, **THE SYSTEM SHALL** render the matching `public-surface.yaml` branch (single Ingress, per-binding Services, or OpenShift Routes) wiring the four public hostnames (`api, console, identity, realtime`) to their backend Services via `componentServiceName` helper (`public-surface.yaml:1-104`).

### S2. The `component-wrapper` subchart

- **WHEN** a component is enabled, **THE SYSTEM SHALL** render a Deployment (or StatefulSet if `wrapper.workload.kind=StatefulSet`) plus optional Service, ServiceAccount, ConfigMap (from `config.inline`), and PVC (`workload.yaml:1-138`, `service.yaml`, `serviceaccount.yaml`, `configmap.yaml`, `pvc.yaml`).
- **WHEN** the Deployment is rendered, **THE SYSTEM SHALL** default `automountServiceAccountToken: false` and `enableServiceLinks: false` (`workload.yaml:32-33`); merge global+local pod security contexts (`workload.yaml:3`); concat global+private-registry pull secrets (`workload.yaml:4`).
- **WHEN** `image.digest` is set, **THE SYSTEM SHALL** prefer it to the tag (`_helpers.tpl:52-56`).
- **WHEN** `global.imageRegistry` is set, **THE SYSTEM SHALL** rewrite the repository prefix to that registry unless the image already carries a registry segment (`_helpers.tpl:30-45`).
- **WHEN** persistence is enabled and `volumePermissions.enabled=true`, **THE SYSTEM SHALL** prepend a `busybox 1.36.1` initContainer that `chmod -R g+rwX` the mount path (`workload.yaml:46-57`).
- **WHEN** `config.inline` is non-empty, **THE SYSTEM SHALL** generate a `<release>-<component>-config` ConfigMap and mount it via `envFrom` (`configmap.yaml`, `workload.yaml:84-87`).

### S3. The Vault subchart (`charts/in-falcone/charts/vault/`)

- **WHEN** installed, **THE SYSTEM SHALL** deploy single-replica Vault with file-backend storage at `/vault/data`, listen on `0.0.0.0:8200` with TLS (`vault-config-configmap.yaml:8-13, :20-21` — default 24h/max 768h lease TTL), cert-manager-issued certificate via `selfsigned-issuer` (`vault-tls-certificate.yaml:11-17`).
- **WHEN** the init Job runs, **THE SYSTEM SHALL** call `vault operator init` with 5 key-shares / 3-threshold (`vault-init-job.yaml:25`), extract via `sed` regex and use root token + unseal keys immediately, then **discard them** (`vault-init-job.yaml:26-32`); enable Kubernetes auth + KV-v2 + audit logging (`vault-init-job.yaml:34-45`); pre-seed `dummy-*` credentials for postgres/mongo/kafka/s3/openwhisk/keycloak with `REPLACE_WITH_32_BYTE_KEY` placeholders (`vault-init-job.yaml:46-54`).
- **WHEN** the audit sidecar runs, **THE SYSTEM SHALL** tail `/vault/audit/vault-audit.log` (read-only PVC mount) and forward to Kafka topic `console.secrets.audit` (`vault-audit-sidecar.yaml:5-18`).
- **WHEN** ingress traffic arrives, **THE SYSTEM SHALL** accept only from pods labelled `vault-access: true` or from the `eso-system` namespace (`vault-networkpolicy.yaml:15-20`); egress permits `0.0.0.0/0:443` (`vault-networkpolicy.yaml:25-30`).
- **WHEN** policies are bound, **THE SYSTEM SHALL** grant read-only access on `secret/data/{platform, functions, gateway, iam}/*` to corresponding policy names, and identity-templated read on `secret/data/tenant/{{entity.tenantId}}/*` for the tenant policy.

### S4. The ESO subchart (`charts/in-falcone/charts/eso/`)

- **WHEN** installed, **THE SYSTEM SHALL** declare a `ClusterSecretStore` named `vault-backend` pointing at `https://vault.secret-store.svc.cluster.local:8200`, Kubernetes auth, role `eso-role`, SA `eso-vault-auth/eso-system`, 24h token expiration, CA from secret `vault-server-tls/secret-store` (`cluster-secret-store.yaml:1-24`).
- **WHEN** installed, **THE SYSTEM SHALL** grant ClusterRole `eso-secret-manager` get/list/watch/create/update/patch/delete on all Secrets cluster-wide, plus token review and SA-token creation (`eso-rbac.yaml:5-15`).
- **WHEN** installed, **THE SYSTEM SHALL** declare 7 `ExternalSecret` resources mapping Vault KV paths to per-namespace Kubernetes Secrets (postgresql, kafka, keycloak, apisix, mongodb, openwhisk-functions, s3) — only postgresql sets `immutable: true` (`platform-postgresql.yaml:13`); keycloak and apisix are `immutable: false` (`iam-keycloak.yaml:9`, `gateway-apisix.yaml:9`).

### S5. The realtime-gateway chart (`charts/realtime-gateway/`)

- **WHEN** installed, **THE SYSTEM SHALL** create a single Deployment of `realtime-gateway` (image `ghcr.io/falcone/realtime-gateway:latest`, default 1 replica) with readiness `/healthz/ready` and liveness `/healthz/live` probes (`deployment.yaml:1-69`), an APISIX `jwt-auth` plugin ConfigMap (`configmap-apisix-plugin.yaml:1-13`), and a Secret named per `secretRefs.databaseUrl.name` carrying three empty-string keys (`secret-ref.yaml:1-9`).
- **WHEN** installed, **THE SYSTEM SHALL NOT** create a Service (no `service.yaml` in `templates/`) — confirming the F2 audit's finding.

### S6. The workspace-docs-service chart (`charts/workspace-docs-service/`)

- **WHEN** installed, **THE SYSTEM SHALL** create a Deployment using bare image `workspace-docs-service:latest` (no registry, no probes, no resources, no security context, no service account, `deployment.yaml:1-39`), a ConfigMap with `WORKSPACE_DOCS_NOTE_MAX_LENGTH` key (`configmap.yaml:1-7`), and a Secret named `workspace-docs-service` with three empty-string keys (`secret.yaml:1-9`).
- **WHEN** installed, **THE SYSTEM SHALL NOT** create a Service.

### S7. The backup-status chart (`helm/charts/backup-status/`)

- **WHEN** installed, **THE SYSTEM SHALL** declare 9 resources of `apiVersion: openwhisk.apache.org/v1` — Actions (`backup-status-collector`, `backup-status-api`, `backup-trigger`, `backup-restore`, `get-operation`, `list-snapshots`, `backup-query-audit`, `backup-audit-fallback`), a `Trigger` (`backup-status-collector-trigger`), a `Rule` (`backup-status-collector-rule`), and an `Alarm` (`backup-status-collector-alarm`) (templates/openwhisk-*.yaml).
- **WHEN** installed, **THE SYSTEM SHALL** create a `backup-status-credentials` Secret with `DB_URL`, `KAFKA_BROKERS`, `KEYCLOAK_JWKS_URL` populated from `values.env.*` (default `""`) (`secret.yaml:1-13`).

### S8. Loose deploy artefacts

- **WHEN** `deploy/k8s/encryption-config.yaml` is applied to a Kubernetes apiserver, **THE SYSTEM SHALL** wrap secret encryption with aescbc + identity providers and read the AES key from a deploy-time substituted base64 string (`encryption-config.yaml:11-15`).
- **WHEN** `deploy/apisix/routes/{scheduling, webhooks}.yaml` are consumed by an external loader, **THE SYSTEM SHALL** declare two routes (`/v1/scheduling/*` with `openid-connect`+`key-auth` plugins; `/v1/webhooks/*` with `keycloak-openid` plugin) routing to OpenWhisk-side upstreams.

---

## GAPS

### G1. Three or four chart trees with no shared structure

The repo carries:
1. `charts/in-falcone/` — production-grade umbrella, validators, helpers, layered values.
2. `charts/realtime-gateway/`, `charts/workspace-docs-service/` — flat single-Deployment charts with no Service, no probes (workspace-docs), no resources, no securityContext.
3. `helm/charts/backup-status/` — uses a CRD apiGroup (`openwhisk.apache.org/v1`) that is **not provisioned anywhere in this repo**.
4. `helm/provisioning-orchestrator/values.yaml` — values file with no chart. There is no `templates/`, no `Chart.yaml`, no consumer of this file.
5. `deploy/helm/*-values.yaml` — values files for charts that don't exist in this repo (webhook-engine, scheduling-engine).

There is no top-level "umbrella of umbrellas" that wires these together; an operator deploying Falcone has to know which trees to install and in which order.

### G2. `helm/charts/backup-status/` installs CRs whose CRD is absent

`openwhisk.apache.org/v1` is not a real Apache project CRD; Apache OpenWhisk does not ship a Kubernetes operator with that apiGroup. The official `openwhisk-deploy-kube` chart creates a Helm-controlled OpenWhisk runtime; actions are registered with `wsk action create` against `/api/v1`, not as Kubernetes CRs. The 9 manifests in `helm/charts/backup-status/templates/` will be **accepted by the Kubernetes apiserver only if a matching CRD has been independently installed**; otherwise `helm install` fails with `no matches for kind "Action" in version "openwhisk.apache.org/v1"`. No such CRD definition exists in this repo. Per the L1 audit, this is consistent with "4 of 5 adapters stubbed, production JWT unsigned" — the chart is decorative.

### G3. `helm/provisioning-orchestrator/values.yaml` is orphan

13 lines of `timeoutSweep`/`orphanSweep`/`env` settings. No chart consumes them. The provisioning-orchestrator package itself (per the C1 audit) is a Node module exposed via the control plane; it doesn't run as its own workload. This values file is a vestigial artefact.

### G4. `deploy/helm/webhook-engine-values.yaml` and `scheduling-engine-values.yaml` target absent charts

Both declare `actions[]` with source paths (e.g., `services/scheduling-engine/actions/scheduling-trigger.mjs`) and `openwhiskActions[]`. There is no `helm/charts/scheduling-engine/` or `helm/charts/webhook-engine/` in the repo. Neither values file's keys map to any chart's `values.yaml` shape that exists here. They appear to be inputs to an out-of-repo deployment system.

### G5. `deploy/apisix/routes/*.yaml` are not loaded by the umbrella chart

The umbrella's `bootstrap-payload-configmap.yaml:42-156` builds APISIX route bodies from `Values.bootstrap.reconcile.apisix.routes` — **not** from `deploy/apisix/routes/`. The two YAMLs in `deploy/apisix/routes/` use ad-hoc shapes:
- `scheduling.yaml:13-14` interpolates `${KEYCLOAK_DISCOVERY_URL}` and `${KEYCLOAK_CLIENT_ID}` — neither Helm-template nor APISIX-resolvable syntax. They are dead placeholders unless an external loader substitutes them.
- `webhooks.yaml:7` uses plugin name `keycloak-openid`, while `scheduling.yaml:11` uses `openid-connect`. APISIX's standard plugin name is `openid-connect`; `keycloak-openid` does not exist — see B6.
- `webhooks.yaml:13` upstream is `openwhisk-webhook-management:80` (bare hostname), not a `*.svc.cluster.local` FQDN. DNS resolution depends on the pod's `dnsConfig.searches`.

### G6. realtime-gateway chart has no Service template, no resource limits, no security context

`charts/realtime-gateway/templates/` contains `deployment.yaml`, `configmap-apisix-plugin.yaml`, `secret-ref.yaml` — **no `service.yaml`**. The deployment exposes `containerPort: 8080` but no Service is created, so the pod is unreachable from inside the cluster. Confirms the F2 audit's finding directly. Additionally:
- No `resources:` block (deployment.yaml:14-69) — pods can consume unbounded CPU/memory.
- No `securityContext` — runs as root by default.
- No `serviceAccountName` — uses `default`.
- Image tag pinned to `:latest` (values.yaml:3).
- `values.yaml:13, :17-19` hard-code `keycloak.example` placeholder hostname.
- `secret-ref.yaml:6-9` creates a real Secret whose three keys (`DATABASE_URL, KEYCLOAK_INTROSPECTION_CLIENT_SECRET, KAFKA_BROKERS`) are empty strings — `helm install` therefore overwrites any out-of-band secret with empty values.

### G7. workspace-docs-service chart is similarly minimal

`charts/workspace-docs-service/templates/` has Deployment + ConfigMap + Secret. **No Service**, **no probes**, **no resources**, **no securityContext**, **no service account**, **no replicas template defaulting** (uses `replicaCount: 1`), and **no chart for the database the service writes to**.
- Image is bare `workspace-docs-service:latest` (deployment.yaml:17), no registry — Kubernetes will resolve from `imagePullPolicy: IfNotPresent` against the default registry, which is unlikely to host this image.
- ConfigMap key in `configmap.yaml:6` is `WORKSPACE_DOCS_NOTE_MAX_LENGTH` while deployment.yaml:23 references `WORKSPACE_DOCS_NOTE_MAX_LENGTH` — consistent. But `WORKSPACE_DOCS_DB_URL`, `KAFKA_BROKERS`, `INTERNAL_API_BASE_URL` come from the chart-rendered Secret (secret.yaml:6-9) with **empty defaults**.

### G8. Component-wrapper has no probes

`charts/in-falcone/charts/component-wrapper/templates/workload.yaml:62-114` — the container spec has no `livenessProbe`, `readinessProbe`, or `startupProbe` blocks. All 10 components rendered through the wrapper (apisix, keycloak, postgres, mongo, kafka, openwhisk, storage, observability, controlPlane, webConsole) come up with **no health gating** — Kubernetes treats Running as Healthy. Per the M4 audit, the platform's observability surface is enormous but a process crash on first request would not roll the pod back.

### G9. Vault init job is a single-point-of-failure for the platform's secret tier

The init Job extracts root token + 5 unseal keys via `sed` regex from stdout, uses them once, and discards them (`vault-init-job.yaml:26-32`). No persistence to a Kubernetes Secret, no escrow to an external KMS, no operator copy. **If the Vault pod dies and the PVC is lost, every secret is permanently inaccessible.** Combined with `replicas: 1` (vault values.yaml:3) and file-backend storage, Vault is a SPOF that cannot be unsealed manually. The HA profile (`values/profiles/ha.yaml`) does not raise the Vault replica count.

### G10. ESO ClusterRole has cluster-wide secret-mutation power

`eso-rbac.yaml:5-15` grants `eso-secret-manager` `create, update, patch, delete` on **all Secrets cluster-wide**, plus token-review and SA-token creation. Standard ESO posture, but absent any scope-narrowing this is the broadest possible blast radius — a compromised ESO controller can rewrite or delete any Secret in any namespace, including kube-system.

### G11. `secret-ref.yaml` files clobber pre-provisioned secrets with empty strings

Three charts (`realtime-gateway/templates/secret-ref.yaml`, `workspace-docs-service/templates/secret.yaml`, `helm/charts/backup-status/templates/secret.yaml`) create Kubernetes Secrets populated from `values.env.*` defaults that are **all empty strings**. If an operator has provisioned the named Secret out-of-band (e.g., via ESO), `helm install` or `helm upgrade` will **overwrite it with empty values**, silently breaking the workload.

### G12. encryption-config.yaml ships a literal placeholder

`deploy/k8s/encryption-config.yaml:14`: `secret: REPLACE_WITH_BASE64_32_BYTE_KEY`. No automation in this repo substitutes the placeholder. Applying this as-is to a kube-apiserver disables secret encryption silently (apiserver rejects the bad base64, falls back to no encryption depending on the build).

### G13. Production hostnames still use `example.com`

`charts/in-falcone/values/prod.yaml:6-9, :66-69` — `api.in-falcone.example.com`, `console.in-falcone.example.com`, `iam.in-falcone.example.com`, `realtime.in-falcone.example.com`. This is the canonical IETF-reserved test domain; using it in `values/prod.yaml` means a default `helm install -f values/prod.yaml` ships a non-routable production. Same `example.com` pattern flagged in F2, F3, N1, O2 audits — confirmed here that the *production-named* values file inherits it.

### G14. The airgap profile uses `.local` TLD

`charts/in-falcone/values/airgap.yaml:6, :15-42` — `registry.airgap.in-falcone.local`. `.local` is reserved for mDNS/Avahi; using it for a container registry hostname assumes mDNS resolution in the cluster network, which is rare in production. Real airgap installations need a real DNS name.

### G15. Bootstrap script SSRF/injection hygiene

Per the subagent (verified at the cited lines), the bootstrap script uses `grep -q '"name":"'$scope_name'"'` (`bootstrap-script-configmap.yaml:202`) and similar `grep`/`sed` patterns at `:234, :264`. If `$scope_name` / `$client_id` / `$KEYCLOAK_SUPERADMIN_USERNAME` contains regex metacharacters, the patterns can mis-match or skip a check. Templated-only inputs reduce real-world risk, but the use of `grep`/`sed` on JSON instead of `jq` is fragile.

### G16. Bootstrap script never provisions authorization scopes

Per the B1 audit, the platform's scope vocabulary (`backup-audit:read:*`, `backup-status:read:*`, `backup:write/restore:*`, `platform:admin:config:*`) is referenced from at least 5 services but never created in Keycloak. The bootstrap script (`bootstrap-script-configmap.yaml:376-382`) loops `client-scope-*.json` from the payload — but per values.yaml structure, only the four identity-context scopes are listed (`tenant-context`, `workspace-context`, `plan-context`, `workspace-roles`). The 9+ authorization scopes are phantom. The `sre` realm role similarly checked at runtime (per L1 audit) is not in `values.bootstrap.oneShot.keycloak.realmRoles` (subagent-confirmed).

### G17. Bootstrap script has no readiness check before talking to Keycloak/APISIX

`bootstrap-script-configmap.yaml:99-109` calls `curl --retry 6 --retry-delay 5` against the Keycloak token endpoint — ~30 sec retry budget. APISIX calls have no retry. There is no `kubectl wait --for=condition=ready pod -l app.kubernetes.io/name=keycloak`. If Keycloak takes >30 sec to come up, bootstrap fails and the platform is half-provisioned.

### G18. `deploy/apisix/routes/scheduling.yaml` upstream namespace mismatch

`scheduling.yaml:18`: `scheduling-management.openwhisk.svc.cluster.local:80`. This assumes OpenWhisk is in the `openwhisk` namespace. The umbrella chart's bootstrap-payload-configmap derives upstreams using `$.Release.Namespace` (`bootstrap-payload-configmap.yaml:44`) — which is whatever namespace Helm installs the umbrella into, usually `in-falcone` per `values.yaml`. If the umbrella is installed into `in-falcone` but the loose `scheduling.yaml` route is applied separately, the route's upstream points to a non-existent service.

### G19. Bootstrap RBAC has Role+RoleBinding but no scoping to specific ConfigMap names

`bootstrap-rbac.yaml:20-30`: Role grants `get, create, update, patch, delete` on **all** ConfigMaps in the namespace, with no `resourceNames` filter. The bootstrap script only needs to manage the lock and marker ConfigMaps (which are named via `bootstrap.lock.name` and `bootstrap.markers.name`). A compromised bootstrap pod can rewrite or delete any ConfigMap in the namespace, including `runtime-configmaps`, `bootstrap-payload`, `bootstrap-script`.

### G20. Bootstrap script does not provision OpenWhisk

The script (`bootstrap-script-configmap.yaml`) talks to Keycloak and APISIX only. OpenWhisk action registration is **never performed by this script** — the umbrella chart enables an OpenWhisk component but provisioning of actions/triggers/rules is left to the L1 (`helm/charts/backup-status/`), F3 (webhook-engine-values, out of repo), I1 (scheduling-engine-values, out of repo) trees, none of which is invoked from the umbrella.

### G21. Vault audit-sidecar creates a bootstrap cycle with Kafka

`vault-audit-sidecar.yaml` forwards Vault audit logs to Kafka topic `console.secrets.audit`. Kafka credentials are managed via ESO+Vault. **At first boot**, Vault must be unsealed before ESO can fetch Kafka credentials; the audit-sidecar therefore cannot publish on first boot until Kafka is up + ESO has materialised its Secret. The chart has no ordering primitive to handle this; the audit-sidecar simply crashlooping is the de-facto behaviour.

### G22. `validate.yaml` does not check image tags

The validator enforces image-repository presence (`validate.yaml:6-8`) but never enforces `image.digest` over `image.tag` or rejects `:latest`. Component charts therefore can ship with mutable tags through this validator unchallenged. The `customer-reference.yaml` profile (not read) and `airgap.yaml` (read; uses tagged images via `repository:` overrides only) inherit this gap.

### G23. `values.yaml` ships `ghcr.io/example/...` for control-plane and web-console

Per the subagent for values.yaml (verified spot-check at line numbers `2062, 2146`): the two custom Falcone images use `ghcr.io/example/in-falcone-control-plane:0.1.0` and `ghcr.io/example/in-falcone-web-console:0.1.0`. `ghcr.io/example` is not a real GitHub Container Registry owner — pulls will 404. Values overlays (`prod.yaml`, `dev.yaml`) do not redefine these `image.repository` values, so even `helm install -f values/prod.yaml` ships the placeholder repository.

### G24. No tests anywhere in the chart trees

There is no `tests/` directory in any chart, no `helm test` hooks, no kind-cluster CI manifest visible. The validation gate (`validate.yaml`) is a render-time check only; no integration test verifies that the rendered manifests actually apply and the bootstrap Job succeeds. The whole P1 capability ships untested as a release artefact.

### G25. Two parallel APISIX route configuration paths

1. Umbrella's `bootstrap-payload-configmap.yaml:42-156` derives routes from `Values.bootstrap.reconcile.apisix.routes`, applies QoS/CORS/JWT/validation profiles inline, PUTs each to APISIX admin.
2. `deploy/apisix/routes/{scheduling, webhooks}.yaml` are standalone shapes with no template engine.

These two systems cannot share definitions (different shapes), have different plugin selection (G5 / B6), and route-id collisions between them are undetectable.

---

## BUGS

### Confirmed (verified-by-author from cited lines)

- **B1. `helm/charts/backup-status/templates/openwhisk-*.yaml` declares CRs against a non-existent CRD.**
  Files use `apiVersion: openwhisk.apache.org/v1` (`openwhisk-actions.yaml:1, :43`, `openwhisk-operations-actions.yaml:3, :37, :69, :88`, `openwhisk-trigger.yaml:2`, `openwhisk-rule.yaml:2`, `openwhisk-alarm.yaml:2`, `openwhisk-audit-actions.yaml:1, :30`). This is **not a real Apache OpenWhisk CRD**. `helm install` against a vanilla cluster will reject with `no matches for kind`. Per the L1 audit, backup-status is "4 of 5 adapters stubbed"; the chart cannot deploy the action runtime to provide the work.

- **B2. `charts/realtime-gateway/` has no `service.yaml`.**
  Verified by directory listing. The Deployment exposes containerPort 8080 (deployment.yaml:20) but no Service routes traffic to it. The pod is unreachable from inside the cluster, regardless of APISIX route configuration. Per the F2 audit, F2 itself is "not a working capability"; this chart's missing Service is the structural cause.

- **B3. `charts/realtime-gateway/values.yaml` uses `:latest` tag and `keycloak.example` placeholder hostname.**
  `values.yaml:3` `tag: latest`; `:13, :17-19` `https://keycloak.example/realms/falcone/...`. `keycloak.example` is not a routable hostname.

- **B4. `charts/workspace-docs-service/` Deployment has no probes, no resources, no securityContext, no Service, bare image name.**
  `deployment.yaml:1-39` — only env vars and a container spec; no `livenessProbe`, `readinessProbe`, `resources`, `securityContext`, `serviceAccountName`. Image `workspace-docs-service:latest` (line 17) is a bare name; resolved against the default registry (typically `docker.io/library/`), which will 404.

- **B5. `secret-ref.yaml` / `secret.yaml` files clobber pre-provisioned secrets with empty strings.**
  `charts/realtime-gateway/templates/secret-ref.yaml:6-9` (`stringData: DATABASE_URL: "" ...`); `charts/workspace-docs-service/templates/secret.yaml:6-9` (same pattern); `helm/charts/backup-status/templates/secret.yaml:9-12` (populates from `values.env.*` defaults of `""`). On `helm upgrade`, any externally-rotated value is overwritten with `""`. Comment at `realtime-gateway/templates/secret-ref.yaml:4` says "K8s Secret ref" but the file *creates* the Secret.

- **B6. `deploy/apisix/routes/webhooks.yaml` uses the non-existent plugin name `keycloak-openid`.**
  `webhooks.yaml:7`: `keycloak-openid:`. Apache APISIX's Keycloak/OIDC plugin is `openid-connect` (used correctly in `scheduling.yaml:11`). The webhooks route loaded into APISIX would generate `unknown plugin: keycloak-openid` and the route would be rejected.

- **B7. `deploy/apisix/routes/scheduling.yaml` uses `${VAR}` placeholders that no loader resolves.**
  `scheduling.yaml:13-14`: `discovery: ${KEYCLOAK_DISCOVERY_URL}` and `client_id: ${KEYCLOAK_CLIENT_ID}`. Neither Helm nor APISIX expands `${...}` syntax natively; APISIX takes literal strings. These placeholders are dead unless a shell pre-processor substitutes them, which is absent from this repo.

- **B8. `deploy/k8s/encryption-config.yaml` ships a literal `REPLACE_WITH_BASE64_32_BYTE_KEY`.**
  `encryption-config.yaml:14`. Applying as-is causes the apiserver to fail to decode the key.

- **B9. `charts/in-falcone/values/prod.yaml` uses `example.com` hostnames.**
  `prod.yaml:6-9, :66-69`. Same drift family as F2/F3/N1/O2. The production values file ships placeholder domains.

- **B10. `charts/in-falcone/values.yaml` ships `ghcr.io/example/...` for control-plane and web-console images.**
  Subagent-cited line `2062` (controlPlane), `2146` (webConsole), verified spot-check passes (string `ghcr.io/example` is present in values.yaml). Production install pulls 404.

- **B11. Vault subchart loses unseal keys on init.**
  `vault-init-job.yaml:26-32` extracts and uses then discards root token and 5 unseal keys. There is no persistence path. Combined with `replicas: 1` (vault `values.yaml:3`) and file-backend storage (`vault-config-configmap.yaml:8-9`), Vault is a single point of permanent data loss for the secret tier.

- **B12. `helm/charts/backup-status/values.yaml` defaults `mongodb/s3/keycloak/kafka` adapters to `enabled: false`.**
  `values.yaml:10-17`. Only the postgresql adapter is enabled by default. Per the L1 audit, this is exactly the "4 of 5 adapters stubbed" condition.

- **B13. `bootstrap-rbac.yaml` grants ConfigMap full mutation cluster-wide-within-namespace.**
  `bootstrap-rbac.yaml:20-30` — no `resourceNames` filter. Bootstrap can mutate any ConfigMap in the install namespace. Should restrict to `[bootstrap.lock.name, bootstrap.markers.name, bootstrapGovernanceCatalog, bootstrapInternalNamespaces]`.

- **B14. `helm/provisioning-orchestrator/values.yaml` has no chart.**
  Directory has only `values.yaml` (13 lines), no `Chart.yaml`, no `templates/`. The file is unconsumed.

- **B15. `helm/charts/backup-status/templates/secret.yaml` populates `DB_URL` from `values.env.DB_URL` which defaults to `""`.**
  `values.yaml:24-28` declares the env block with all empty defaults. `secret.yaml:10-12` interpolates them via `stringData: DB_URL: "" KAFKA_BROKERS: "" KEYCLOAK_JWKS_URL: ""`. Default install therefore wires empty connection strings into every backup-status action.

- **B16. realtime-gateway chart has no `resources:` block.**
  `deployment.yaml:14-69`. No CPU/memory limits — pods can starve neighbours.

- **B17. Component-wrapper has no probes at all.**
  `workload.yaml:62-114` — no probe blocks. All 10 components rendered through the wrapper come up without health gating.

### Likely

- **B18. Bootstrap-script `grep`/`sed` on JSON breaks for names with regex metacharacters.**
  Per the subagent, `bootstrap-script-configmap.yaml:202, :234, :264` use unquoted variables in `grep -q '"name":"'$var'"'`. Inputs are templated by Helm so risk is low in practice, but a future scope name with a `.` becomes a wildcard.

- **B19. Bootstrap-script never validates that Keycloak/APISIX are ready.**
  Per the subagent, no `kubectl wait` and only 30s of retry budget on token acquisition. Slow first-install of Keycloak crashes the bootstrap.

- **B20. Bootstrap-script never provisions OpenWhisk actions.**
  `bootstrap-script-configmap.yaml` talks to Keycloak + APISIX only. OpenWhisk actions (for L1 backup-status, F3 webhook-engine, I1 scheduling-engine) are not provisioned by this chart. Per B1, B6 the alternative provisioning paths are broken.

- **B21. `deploy/apisix/routes/scheduling.yaml` upstream is namespace-`openwhisk` while umbrella uses `Release.Namespace`.**
  `scheduling.yaml:18` vs `bootstrap-payload-configmap.yaml:44`. If both are installed, the loose route mis-targets unless OpenWhisk happens to be in namespace `openwhisk`.

- **B22. Vault audit-sidecar boot-cycle.**
  Vault must unseal before ESO can pull Kafka credentials. The audit sidecar that writes to Kafka cannot succeed until that chain is complete. There's no readiness gating.

- **B23. ESO ClusterRole permits delete on all Secrets cluster-wide.**
  `eso-rbac.yaml:7-8`. Standard ESO posture but worth flagging — a compromised ESO controller can wipe kube-system secrets.

- **B24. Component-wrapper's normalise-repository helper rewrites the registry prefix even for fully-qualified images.**
  `_helpers.tpl:30-45`. The condition `or (contains "." $first) (contains ":" $first) (eq $first "localhost")` detects a registry segment, but if the image is e.g. `ghcr.io/example/foo:tag` and `global.imageRegistry=registry.airgap.in-falcone.local`, the helper rewrites it to `registry.airgap.in-falcone.local/example/foo:tag` — losing the original registry host. Useful for airgap rewrites, dangerous when the operator wants to mix registries.

- **B25. Public-surface `LoadBalancer` branch creates one Service per binding with `allocateLoadBalancerNodePorts: true` default.**
  `public-surface.yaml:59` default `true`. On clouds where each LoadBalancer is an expensive resource, the four bindings become four LBs.

- **B26. Validation `bootstrap.lock.name != markers.name` (`validate.yaml:74-76`) defends against trivial misconfiguration but doesn't defend against marker rewrite via the RoleBinding (B13).**
  A compromised bootstrap can rewrite the marker ConfigMap to a different hash and force re-run of one-shot logic, including re-creating the superadmin user — which may rotate the password.

### Needs verification (requires running code)

- **B27. Whether `validate.yaml`'s `fail` calls in `range` blocks actually halt rendering.**
  `validate.yaml:34-42` iterates `publicSurface.bindings`; `fail` inside a range typically short-circuits the iteration but Helm's semantics are sometimes surprising. Worth a `helm template` smoke test.

- **B28. Whether the bootstrap script's `BREAK_GLASS_EXISTING_LOCK=true` path is reachable from operator workflows.**
  `bootstrap-script-configmap.yaml:50-56`. There's no documented kubectl recipe to set this env var on a Helm-managed Job; an operator may need to `helm template` + `kubectl apply --dry-run` to override.

- **B29. Whether `eso-system` namespace exists when the eso subchart's RoleBinding subject references it.**
  `eso-rbac.yaml:23`. If the External Secrets Operator hasn't been installed first (via the upstream Helm dependency at `eso/Chart.yaml:7-10`), the SA reference is dangling.

- **B30. Whether the `vault-server-tls/secret-store` reference in `eso/values.yaml:9-12` resolves.**
  The Vault subchart issues a TLS certificate (`vault-tls-certificate.yaml`) but I have not verified that the resulting secret name matches `vault-server-tls` in namespace `secret-store`. Mismatch breaks ESO's CA trust.

- **B31. Whether `runtime-configmaps.yaml`'s ConfigMap names (`config.configMapNames.gateway` etc.) match the consumer expectations in the realtime-gateway/control-plane code.**
  The umbrella writes `Values.config.configMapNames.gateway` (`runtime-configmaps.yaml:4`); the realtime-gateway chart (separate tree) doesn't mount this ConfigMap. A consumer expecting it might read empty.

- **B32. Whether `helm install --create-namespace` interacts correctly with `templates/namespace.yaml`'s conditional render.**
  `namespace.yaml:1`: `if .Values.global.createNamespace`. Helm's `--create-namespace` flag is separate; double-creating is a Helm-side warning, not an error, but worth confirming.

---

## Scope note for downstream spec authoring

P1 ships **two qualitatively different capabilities** under one name:

1. **The umbrella chart at `charts/in-falcone/`** — solid engineering. 30 validators (`validate.yaml`), one entry chart with 10 wrapper components, layered profiles (dev/staging/sandbox/prod/airgap, plus all-in-one/standard/ha), an idempotent post-install bootstrap Job with marker-based skip semantics, an SHA-256 hash of one-shot config to detect drift, dependency on a Vault subchart and an ESO subchart with NetworkPolicy, RBAC, and per-namespace ExternalSecret bindings. Bugs are concrete and fixable (`example.com` in prod, `ghcr.io/example` placeholder, missing probes, no scope-narrowed RBAC, single-replica Vault with no key escrow).

2. **Everything else** — five orphan chart trees (`realtime-gateway`, `workspace-docs-service`, `backup-status`, `provisioning-orchestrator/`, `deploy/helm/*-values.yaml`) plus two loose APISIX route YAMLs plus a stand-alone encryption-config. The umbrella does not wire any of them. They have no shared structure, no shared validation, and at least three structural defects (B1: fake OpenWhisk CRD; B2: missing realtime-gateway Service; B5: chart-managed Secret clobber).

The **six must-fix items** before P1 can claim to deploy the platform:

1. **B1 + G2 + B20** — Either implement the OpenWhisk CRD operator (`openwhisk.apache.org/v1`) or rewrite `helm/charts/backup-status/` to use ConfigMaps + `wsk action create` post-hooks, or fold the backup-status actions into the umbrella's OpenWhisk component. As-is, backup-status cannot install.
2. **B2 + B16 + B17 + G6 + G7** — Fix the orphan charts (`realtime-gateway`, `workspace-docs-service`) to be installable: add Services, probes, resources, securityContext, real image references. Or remove them and consolidate into the umbrella.
3. **B5 + G11** — Remove the `secret*.yaml` templates that overwrite pre-provisioned secrets with empty strings. Move secret creation out of the chart and into ESO.
4. **B9 + B10 + G13 + G23** — Replace `example.com` and `ghcr.io/example` placeholders with real configurable defaults; the production values file is currently undeployable.
5. **B11 + G9** — Vault must either run as a real HA deployment with auto-unseal (cloud KMS, Transit, or external HSM), or the init Job must escrow unseal keys to a separate Kubernetes Secret with strict RBAC. Single-replica file-backed Vault with discarded keys is not production-viable.
6. **B13 + G19** — Scope the bootstrap RBAC to the specific ConfigMap names it actually mutates.

After those, the umbrella is shippable. Until then, the platform's deployment story is "install the umbrella, then accept that 4 of the 16 capabilities in the map have no working deployment artefact."
