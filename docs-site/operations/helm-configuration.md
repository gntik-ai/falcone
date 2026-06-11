# Helm Configuration

In Falcone is configured through the umbrella chart `charts/in-falcone`. This page covers the structure of `values.yaml` and how to compose it. For a key-by-key description of every value you can set, see the [Helm Values Reference](/operations/values-reference); for full install walkthroughs see [Installation](/guide/installation).

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
| `apisix`, `keycloak`, `postgresql`, `mongodb`, `kafka`, `openwhisk`, `storage`, `observability`, `controlPlane`, `controlPlaneExecutor`, `webConsole` | Per-component config (each toggled by `<component>.enabled`) |
| `gatewayPolicy` | Gateway routing/scope/rate-limit policy |
| `eso`, `vault` | Secret management (External Secrets Operator + Vault) |

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

`config.inheritanceOrder` records this layering; `deployment.profile` selects the sizing profile.

## Enabling / disabling components

Point a component at an external managed service by disabling its in-cluster copy:

```yaml
postgresql:
  enabled: false        # use an external Postgres instead
config:
  secretRefs:
    postgresCredentials:
      existingSecret: my-external-postgres   # supply username/password/database
```

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
