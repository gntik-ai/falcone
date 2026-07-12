# Helm Configuration

In Falcone is configured through the umbrella chart `charts/in-falcone`. This page covers the structure of `values.yaml` and how to compose it. For full install walkthroughs see [Installation](/guide/installation).

## Top-level value sections

| Key | Controls |
| --- | --- |
| `global` | Cross-cutting: environment, namespace, airgap, private registry, image pull secrets |
| `publicSurface` | Hostnames, bindings, ingress/route exposure, TLS mode |
| `environmentProfile` | Named environment defaults |
| `deployment` | Active sizing `profile` + `valuesLayers` ordering |
| `platform` | `target` (kubernetes/openshift), `network.exposureKind`, `securityProfile` |
| `config` | ConfigMap names + `secretRefs` (existing-secret references) + inheritance order |
| `bootstrap` | Reconcile payload (gateway routes, realm), lock/marker ConfigMaps |
| `apisix`, `keycloak`, `postgresql`, `postgresqlVector`, `ferretdb`, `documentdb`, `kafka`, `seaweedfs`, `observability`, `controlPlane`, `controlPlaneExecutor`, `webConsole`, `workflowWorker`, `temporal`, `mcp` | Core component config. Fresh installs always render the complete platform; legacy `<component>.enabled=false` disables are rejected by chart validation. `ferretdb` + `documentdb` are the document store ([ADR-14](/architecture/adrs#adr-14-migrate-document-store-from-mongodb-to-ferretdb-v2-documentdb)); `seaweedfs` is the object store ([ADR-13](/architecture/adrs#adr-13-migrate-object-store-from-minio-to-seaweedfs)). The former `mongodb` and `storage` (MinIO) components have been removed; functions run on Knative (provisioned by the control-plane executor — no datastore component). |
| `gatewayPolicy` | Gateway routing/scope/rate-limit policy |
| `eso`, `openbao` | Core secret management (External Secrets Operator + OpenBao). Fresh installs provision both and wire workload Secrets through the `openbao-backend` `ClusterSecretStore`. |

## Composing values

Layer files in the order the chart recommends (later wins):

```
common → environment → customer → platform → airgap → localOverride → secretRefs
```

```bash
helm dependency build charts/in-falcone

helm upgrade --install falcone charts/in-falcone \
  -n falcone --create-namespace \
  -f charts/in-falcone/values/prod.yaml \              # environment
  -f charts/in-falcone/values/customer-reference.yaml \ # customer
  -f charts/in-falcone/values/platform-kubernetes.yaml \# platform
  -f charts/in-falcone/values/profiles/standard.yaml    # sizing
```

Helm creates the release namespace before pre-install hooks run. By default the chart renders Namespace resources for the ESO/OpenBao support namespaces (`global.createNamespace=true`). For externally managed namespaces, omit Helm namespace auto-creation, set `global.createNamespace=false`, and pre-create/adopt the required namespaces in the platform layer.

`config.inheritanceOrder` records this layering; `deployment.profile` selects the sizing profile.

## Component defaults

Falcone's supported fresh-install shape is the complete core platform. The chart rejects
`<component>.enabled=false` for core components, including datastores, OpenBao/ESO, Temporal,
workflow worker, MCP wiring, pgvector, the control-plane executor, web console, bootstrap, and
observability. Component values now tune sizing, images, storage, networking, and security settings;
they do not opt core services out of the baseline.

External managed-service integrations must preserve the same application contracts and supply the
required `config.secretRefs`. Do not remove a core component by setting `enabled=false`; add or use
a documented managed-service path that keeps the chart validation and runtime wiring coherent.

Object storage is the `seaweedfs` component (**SeaweedFS**, S3-compatible, Apache-2.0;
[ADR-13](/architecture/adrs#adr-13-migrate-object-store-from-minio-to-seaweedfs), which replaced the
former MinIO `storage` component). The document API is served by the **FerretDB + DocumentDB**
two-layer stack — the `ferretdb` gateway (MongoDB-wire-compatible) over the `documentdb` engine
(DocumentDB-on-PostgreSQL; [ADR-14](/architecture/adrs#adr-14-migrate-document-store-from-mongodb-to-ferretdb-v2-documentdb)).
Both **are implemented in the chart** and enabled by default; the former `mongodb` server component
has been removed. See the [FerretDB Document-Store Runbook](/architecture/ferretdb).

## Exposure & TLS

```yaml
platform:
  target: kubernetes          # or openshift
  network:
    exposureKind: Ingress     # or Route
publicSurface:
  hostnames:
    api: api.example.test
    identity: id.example.test
    realtime: rt.example.test
    console: console.example.test
  tls:
    mode: <your-tls-mode>
```

## Schema validation

The chart ships a strict `values.schema.json`, validated on `helm install/upgrade`. When iterating on a partial values set, bypass it with `--skip-schema-validation`.

## Inspecting a render

```bash
helm template falcone charts/in-falcone -f <your values> | less
```

This is the fastest way to confirm exposure objects, bootstrap payload and image references before applying.
