# Helm Values Reference

A reference for the values you can set in the umbrella chart `charts/in-falcone` (`values.yaml`, validated by `values.schema.json`). For how to *compose* values files, see [Helm Configuration](/operations/helm-configuration); for full install walkthroughs, [Installation](/guide/installation).

> Defaults shown are the chart's `dev` defaults. Override them by layering an environment/platform/customer values file (later files win).

[[toc]]

## How the chart is organised

Values fall into two groups:

1. **Platform-wide sections** — `global`, `publicSurface`, `environmentProfile`, `deployment`, `platform`, `config`, `bootstrap`, `gatewayPolicy`, `eso`, `vault`.
2. **Per-component sections** — `apisix`, `keycloak`, `postgresql`, `mongodb`, `kafka`, `openwhisk`, `storage`, `observability`, `controlPlane`, `controlPlaneExecutor`, `webConsole`. **Every component shares the same value shape** (the `component-wrapper` pattern), described once in [Common component values](#common-component-values).

---

## `global`

Cross-cutting settings inherited by every component.

| Key | Default | Description |
| --- | --- | --- |
| `global.nameOverride` | `in-falcone` | Base name for generated resources |
| `global.namespace` | `in-falcone-dev` | Target namespace |
| `global.environment` | `dev` | Logical environment (`dev`/`sandbox`/`staging`/`prod`) |
| `global.createNamespace` | `true` | Create the namespace if missing |
| `global.imageRegistry` | `""` | Global registry prefix for all images (overridden per air-gap) |
| `global.imagePullSecrets` | `[{name: ghcr-reader}]` | Pull secrets attached to every pod |
| `global.airgap.enabled` | `false` | Enable air-gapped behaviour |
| `global.privateRegistry.*` | disabled | Private registry, pull-secret names, CA bundle config map |
| `global.defaultStorageClass` | `""` | Default `storageClass` for persistent components |
| `global.podSecurity.runAsNonRoot` | `true` | Pod-level security baseline |
| `global.podSecurity.fsGroup` | `1001` | Filesystem group |
| `global.podSecurity.seccompProfile.type` | `RuntimeDefault` | Seccomp profile |

## `publicSurface`

The externally exposed endpoints (API, console, identity, realtime) and how they're published.

| Key | Default | Description |
| --- | --- | --- |
| `publicSurface.hostnames.{api,console,identity,realtime}` | `*.dev.in-falcone.example.com` | Public hostnames per surface |
| `publicSurface.routePrefixes.{controlPlane,identity,realtime,console}` | `/control-plane`, `/auth`, `/realtime`, `/` | Path prefixes |
| `publicSurface.bindings.{api,identity,realtime,console}` | apisix/keycloak/webConsole | Which component + service port + path each surface binds to |
| `publicSurface.certificates.wildcardSecretName` | `in-falcone-dev-wildcard-tls` | Wildcard TLS secret |
| `publicSurface.certificates.surfaces.*` | per-surface TLS secrets | TLS secret per surface |
| `publicSurface.tls.mode` | `clusterManaged` | TLS strategy |
| `publicSurface.ingress.className` | `nginx` | Ingress class (Kubernetes target) |
| `publicSurface.ingress.annotations` | `{}` | Extra Ingress annotations |
| `publicSurface.route.tls.termination` | `edge` | OpenShift Route TLS termination |
| `publicSurface.route.tls.insecureEdgeTerminationPolicy` | `Redirect` | Redirect HTTP→HTTPS on Routes |
| `publicSurface.loadBalancer.*` | port 443, `Cluster` traffic policy | LoadBalancer exposure (ports, source ranges, IP families) |
| `publicSurface.optionalWorkspaceSubdomains.enabled` | `false` | Per-workspace subdomains (`{workspaceSlug}.…`) |

## `environmentProfile`

Per-environment behaviour toggles.

| Key | Default | Description |
| --- | --- | --- |
| `environmentProfile.id` | `dev` | Profile id |
| `environmentProfile.diagnostics.logLevel` | `debug` | Log verbosity |
| `environmentProfile.diagnostics.debugEndpoints` | `true` | Expose debug endpoints |
| `environmentProfile.diagnostics.passthroughHeaders` | `true` | Pass through debug headers |
| `environmentProfile.demoData.enabled` | `true` | Seed demo data |
| `environmentProfile.limitsProfile` | `relaxed` | Resource/limits profile |

## `deployment`

Topology, values-layering metadata, sizing profile and upgrade policy.

| Key | Default | Description |
| --- | --- | --- |
| `deployment.topology.mode` | `single_cluster` | Cluster topology |
| `deployment.topology.region` | `eu-west-1` | Region |
| `deployment.profile` | `standard` | Active sizing profile (`all-in-one`/`standard`/`ha`) |
| `deployment.recommendedProfiles.pathPattern` | `values/profiles/{profile}.yaml` | Where profile files live |
| `deployment.valuesLayers.*` | common/environment/customer/platform/airgap/localOverride | The documented layering order |
| `deployment.upgrade.allowInPlace` | `true` | Allow in-place upgrades |
| `deployment.upgrade.supportedPreviousVersions` | `[0.2.0]` | Upgradable-from versions |
| `deployment.upgrade.allowDowngrade` | `false` | Block downgrades |
| `deployment.upgrade.strategy` | `rolling` | Rollout strategy |

## `platform`

Adapts the chart to the target cluster.

| Key | Default | Description |
| --- | --- | --- |
| `platform.target` | `kubernetes` | `kubernetes` or `openshift` |
| `platform.network.exposureKind` | `Ingress` | `Ingress` (k8s) or `Route` (OpenShift) |
| `platform.securityProfile` | `restricted` | `restricted` (k8s) / `restricted-v2` (OpenShift) |
| `platform.openshift.enabled` | `false` | OpenShift-specific behaviour |
| `platform.routeAnnotations` | nginx ingress class | Annotations applied to exposure objects |
| `platform.podSecurity.*` | `runAsNonRoot`, `RuntimeDefault` | Platform pod-security baseline |

## `config`

ConfigMap names and the **secret references** that feed credentials to components (see [Secret Management](/operations/secret-management)).

| Key | Default | Description |
| --- | --- | --- |
| `config.inheritanceOrder` | common→…→secretRefs | Effective value-resolution order |
| `config.configMapNames.{gateway,controlPlane,webConsole}` | `in-falcone-*-config` | Names of generated ConfigMaps |
| `config.secretRefs.gatewayTls` | `in-falcone-dev-api-tls` (`tls.crt`,`tls.key`) | Gateway TLS |
| `config.secretRefs.identityClient` | `in-falcone-identity-client` (`client-id`,`client-secret`) | Keycloak client |
| `config.secretRefs.postgresCredentials` | `in-falcone-postgresql` (`username`,`password`,`database`) | Postgres creds |
| `config.secretRefs.mongoCredentials` | `in-falcone-mongodb` (`username`,`password`,`database`) | Mongo creds |
| `config.secretRefs.kafkaCredentials` | `in-falcone-kafka` (`username`,`password`) | Kafka creds |
| `config.secretRefs.objectStorageCredentials` | `in-falcone-storage` (`access-key`,`secret-key`) | Storage creds |

Point any of these at an externally managed secret by changing `existingSecret`.

---

## Common component values

Every component (`apisix`, `keycloak`, `postgresql`, `mongodb`, `kafka`, `openwhisk`, `storage`, `observability`, `controlPlane`, `webConsole`) is rendered by the shared `component-wrapper` subchart and accepts the **same keys**. Set them under the component's top-level key, e.g. `postgresql.replicas: 3`.

| Key | Typical default | Description |
| --- | --- | --- |
| `<c>.enabled` | `true` | Render this component (set `false` to use an external service) |
| `<c>.wrapper.workload.kind` | `Deployment`/`StatefulSet` | Workload type |
| `<c>.image.{repository,tag,pullPolicy}` | per component | Container image |
| `<c>.replicas` | per component | Replica count |
| `<c>.serviceAccount.{create,name,automountToken}` | `create: true`, `automountToken: false` | Service account (token **not** mounted by default — least privilege) |
| `<c>.service.{enabled,type,port,targetPort,portName,annotations}` | `ClusterIP` | Service exposure |
| `<c>.ports[]` | per component | Container ports |
| `<c>.resources.{requests,limits}` | per component | CPU/memory |
| `<c>.env[]` | per component | Extra environment variables |
| `<c>.envFromSecrets[]` / `<c>.envFromConfigMaps[]` | per component | Env sourced from Secrets/ConfigMaps |
| `<c>.persistence.{enabled,size,storageClass,existingClaim,accessModes,mountPath}` | varies | Persistent volume (data components default `enabled: true`) |
| `<c>.podAnnotations` / `<c>.podLabels` | `{}` | Pod metadata |
| `<c>.podSecurityContext` / `<c>.securityContext` | hardened (`drop: [ALL]`, `runAsNonRoot`) | Security contexts |
| `<c>.nodeSelector` / `<c>.tolerations` / `<c>.affinity` | `{}`/`[]` | Scheduling |
| `<c>.extraVolumes` / `<c>.extraVolumeMounts` | `[]` | Extra volumes |
| `<c>.initContainers` | `[]` | Init containers |
| `<c>.volumePermissions.enabled` | `false` | chown init for volumes |
| `<c>.config.inline` | per component | **Component-specific tunables** (see below) |

### Per-component defaults & specific knobs

| Component | Image (default) | Replicas | Persistence | `config.inline` (component-specific) |
| --- | --- | --- | --- | --- |
| `apisix` | `apache/apisix:3.10.0` | 2 | off | `APISIX_STAND_ALONE: "true"` |
| `keycloak` | `keycloak:26.1.0` | 1 | off | `publicPath: /auth` |
| `postgresql` | `bitnami/postgresql:17.2.0` | 1 | 20Gi | `tenantIsolationMode: schema-per-tenant` |
| `mongodb` | `bitnami/mongodb:8.0.0` | 1 | 20Gi | `tenantPartitionKey: tenantId` |
| `kafka` | `bitnami/kafka:3.9.0` | 3 | 50Gi | `deliverySemantics: at-least-once` |
| `openwhisk` | `apache/openwhisk-controller:2.0.0` | 2 | off | `executionPlane: serverless` — **disabled** (functions run on Knative) |
| `storage` | `minio/minio` | — | yes | object storage |
| `observability` | `prom/prometheus:3.2.1` | 1 | 20Gi | metrics stack: retention, required labels, tenant-isolation labels, scrape targets |
| `controlPlane` | `ghcr.io/gntik-ai/in-falcone-control-plane:0.6.2` | 2 | off | `openapiPath: /control-plane/openapi` |
| `webConsole` | `ghcr.io/example/in-falcone-web-console:0.1.0` | 2 | off | `auth.*` (see below) |

> [!NOTE]
> `kafka.config.inline.deliverySemantics`, `postgresql.config.inline.tenantIsolationMode` and `mongodb.config.inline.tenantPartitionKey` are platform-behaviour knobs surfaced through the chart — change them deliberately, they affect isolation/semantics.

### `controlPlane.functionExecutor`

| Key | Default | Description |
| --- | --- | --- |
| `controlPlane.functionExecutor.enabled` | `true` | Gates the Knative function RBAC (`templates/control-plane-rbac.yaml`). When functions are enabled, also set `controlPlane.serviceAccount.automountToken: true` (the executor needs the token to create Knative Services). The per-function runtime image comes from the `FN_RUNTIME_IMAGE` env in the overlay. |

### `controlPlaneExecutor` (opt-in data plane)

The runnable data-plane executor. **Disabled by default**; when enabled, the data-plane APISIX routes (`/v1/postgres|mongo|events|functions/*`) are sent here.

| Key | Default | Description |
| --- | --- | --- |
| `controlPlaneExecutor.enabled` | `false` | Enable the executor |
| `controlPlaneExecutor.image` | `…/in-falcone-control-plane-executor:0.9.0` | Executor image |
| `controlPlaneExecutor.replicas` | `2` | Replicas |
| `controlPlaneExecutor.readinessProbe` | `/healthz:8080` | Readiness probe |
| `controlPlaneExecutor.env[]` | `[]` | **Environment-specific** — set in the overlay (required: `CONTROL_PLANE_UPSTREAM`; plus `PGHOST/PGUSER/PGPASSWORD`, `MONGO_*`, `KAFKA_BROKERS`, optional `KEYCLOAK_*`). See [Environment Variables](/operations/environment-variables). |

> [!IMPORTANT]
> When enabling the executor you **must** set `CONTROL_PLANE_UPSTREAM` (where it proxies non-data-plane routes). If unset, the executor returns `404` for browse/inventory/management routes.

### `webConsole.auth`

Console authentication and account-lifecycle policy (in addition to the [common values](#common-component-values)).

| Key | Default | Description |
| --- | --- | --- |
| `webConsole.auth.issuerUrl` | Keycloak realm URL | OIDC issuer |
| `webConsole.auth.realm` / `clientId` | `in-falcone-platform` / `in-falcone-console` | OIDC realm + client |
| `webConsole.auth.grantType` | `password` | Auth grant |
| `webConsole.auth.tokenStorage` | `memory_with_refresh_rotation` | Token storage strategy |
| `webConsole.auth.{login,signup,…}Path` | `/login`, `/signup`, … | Console routes |
| `webConsole.auth.autoSignupPolicy.{globalMode,environmentModes,planModes}` | approval/auto/disabled per env+plan | Self-signup policy |
| `webConsole.auth.expirationPolicies.invitations` | `defaultTtl 72h`, `maxTtl 168h` | Invitation TTLs |
| `webConsole.auth.expirationPolicies.humanCredentials` | `passwordMaxAge 90d`, `gracePeriod 7d` | Password lifecycle |
| `webConsole.auth.expirationPolicies.serviceCredentials` | `defaultTtl 30d`, `rotateBefore 7d` | Service-credential lifecycle |
| `webConsole.auth.expirationPolicies.sessions` | `maxLifetime 12h`, `idleTimeout 30m` | Session lifecycle |

---

## `bootstrap`

The install/upgrade hook job that reconciles gateway routes, the identity realm and initial config. It is idempotent (lock + marker ConfigMaps).

| Key | Default | Description |
| --- | --- | --- |
| `bootstrap.enabled` | `true` | Run the bootstrap job |
| `bootstrap.serviceAccount.{create,name}` | `create: true` | Job service account |
| `bootstrap.job.image.{repository,tag}` | `bitnami/kubectl:1.32.2` | Job image |
| `bootstrap.job.backoffLimit` | `1` | Retries |
| `bootstrap.job.activeDeadlineSeconds` | `900` | Timeout |
| `bootstrap.job.ttlSecondsAfterFinished` | `86400` | Cleanup TTL |
| `bootstrap.job.{resources,nodeSelector,tolerations,affinity,extraEnv}` | hardened defaults | Job pod spec |
| `bootstrap.lock.name` | `in-falcone-bootstrap-lock` | Idempotency lock ConfigMap |
| `bootstrap.lock.breakGlassExistingLock` | `false` | Force past a stuck lock |
| `bootstrap.markers.name` | `in-falcone-bootstrap-state` | Completion marker ConfigMap |
| `bootstrap.secretResolution.sources.*` | kubernetesSecret refs | Where bootstrap reads admin credentials (Keycloak admin, superadmin, APISIX admin key) |
| `bootstrap.oneShot.*` | — | One-time reconcile payload (realm, routes, initial config) |

## `gatewayPolicy`

The gateway's routing/security policy (rendered into the gateway config). Mostly advanced; common knobs:

| Key | Default | Description |
| --- | --- | --- |
| `gatewayPolicy.oidc.enabled` | `true` | Validate Bearer JWTs at the gateway (Keycloak) |
| `gatewayPolicy.oidc.{realm,issuerUrl,discoveryUrl,clientId}` | Keycloak realm | OIDC settings |
| `gatewayPolicy.oidc.bearerOnly` | `true` | Bearer-only (no interactive login at the gateway) |
| `gatewayPolicy.cors.*` | — | CORS policy |
| `gatewayPolicy.rateLimit.*` | — | Rate-limit policy (per-key `limit-count`; see [Gateway](/api/gateway)) |
| `gatewayPolicy.requestValidation.*` | — | Request validation rules |
| `gatewayPolicy.idempotency.*` | — | Idempotency-key handling |
| `gatewayPolicy.correlation.*` | — | Correlation-id propagation |
| `gatewayPolicy.publicRoutes` / `passthrough` | — | Routes exempt from auth / passthrough |
| `gatewayPolicy.familyPolicies` / `accessMatrix` | — | Per-route-family policy + the privilege-domain access matrix |

## `eso` & `vault`

| Key | Default | Description |
| --- | --- | --- |
| `eso.enabled` | `false` | Deploy/integrate the External Secrets Operator |
| `vault.enabled` | `false` | Deploy/integrate HashiCorp Vault as the secret backend |

When enabled, secrets flow `Vault → ESO → Kubernetes Secret → pods` via the `config.secretRefs` mapping. See [Secret Management](/operations/secret-management).

---

## Common overrides cheat-sheet

```yaml
# Scale a component
postgresql:
  replicas: 3
  resources:
    requests: { cpu: "1", memory: 2Gi }
  persistence:
    size: 100Gi
    storageClass: fast-ssd

# Use an external managed database (disable the in-cluster one)
mongodb:
  enabled: false
config:
  secretRefs:
    mongoCredentials:
      existingSecret: my-atlas-credentials

# Switch exposure to OpenShift
platform:
  target: openshift
  network: { exposureKind: Route }
  securityProfile: restricted-v2

# Turn on the opt-in data-plane executor
controlPlaneExecutor:
  enabled: true
  env:
    - { name: CONTROL_PLANE_UPSTREAM, value: http://falcone-control-plane:8080 }
    - { name: PGHOST, value: falcone-postgresql }
    # …PG/MONGO/KAFKA connection env
```

Inspect the fully rendered result before applying:

```bash
helm template falcone charts/in-falcone -f <your-values.yaml> | less
```
