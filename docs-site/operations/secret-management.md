# Secret Management

Falcone keeps secret **values** out of git and out of values files. The chart references existing Kubernetes Secrets by name (`config.secretRefs`), and those Secrets are sourced from **OpenBao** (the open-source HashiCorp Vault fork) via the **External Secrets Operator (ESO)**.

## Model

```
OpenBao  ──(External Secrets Operator)──▶  Kubernetes Secret  ──(secretRefs / secretKeyRef)──▶  Pods
```

- `openbao` (chart alias) — the secret backend (image `openbao/openbao`, CLI `bao`). The dev compose stack runs OpenBao in `-dev` mode; production points ESO at your OpenBao. Disabled by default — opt in via `openbao.enabled=true` (the kind self-signed TLS path is `deploy/kind/values-kind-vault.yaml`).
- `eso` (chart alias) — the External Secrets Operator, which materializes OpenBao KV paths into namespaced Kubernetes Secrets. Its `ClusterSecretStore` (`openbao-backend`) uses ESO's `vault` provider type, which is the OpenBao-compatible client (the KV v2 REST surface is byte-compatible).
- `config.secretRefs` — the chart's map of which existing Secret + keys feed each component.

## secretRefs

```yaml
config:
  secretRefs:
    postgresCredentials:    { existingSecret: in-falcone-postgresql, keys: [username, password, database] }
    mongoCredentials:       { existingSecret: in-falcone-documentdb, keys: [username, password, database] }
    kafkaCredentials:       { existingSecret: in-falcone-kafka,      keys: [username, password] }
    objectStorageCredentials:{ existingSecret: in-falcone-storage,   keys: [access-key, secret-key] }
    identityClient:         { existingSecret: in-falcone-identity-client, keys: [client-id, client-secret] }
    gatewayTls:             { existingSecret: in-falcone-dev-api-tls, keys: [tls.crt, tls.key] }
```

To use an externally managed credential, set `existingSecret` to your Secret (and disable the in-cluster component if you're pointing at a managed service).

## Sensitive material is mounted by reference, never inlined

The platform never embeds secret values in manifests or values. Generated material is created as a Secret and consumed via `secretKeyRef`. The document store is **FerretDB over DocumentDB-on-PostgreSQL**, so there is **no replica-set keyfile** — the gateway authenticates to its engine with Postgres credentials. For example, the DocumentDB engine password the FerretDB gateway connects with:

```bash
openssl rand -hex 24 | tr -d '\n' | \
  kubectl create secret generic in-falcone-documentdb \
    --from-file=password=/dev/stdin -n falcone
# referenced via secretKeyRef (it feeds FERRETDB_POSTGRESQL_URL / MONGO_URI), not an inline value
```

> [!TIP]
> Avoid putting provider-shaped literals (e.g. `sk_live_…`, real cloud keys) even in test fixtures — secret scanners and push protection will reject the commit. Use clearly non-provider placeholders.

## Air-gapped registries

Air-gapped installs add a registry pull secret and CA bundle (`global.imagePullSecrets`, `global.privateRegistry.caBundleConfigMap`) — create these in the namespace before installing. See [Installation → Air-gapped](/guide/installation#air-gapped).

## TLS

Gateway TLS comes from the `gatewayTls` secret (`tls.crt` / `tls.key`); the active mode is set by `publicSurface.tls.mode`.
