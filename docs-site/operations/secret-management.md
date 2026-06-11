# Secret Management

In Falcone keeps secret **values** out of git and out of values files. The chart references existing Kubernetes Secrets by name (`config.secretRefs`), and those Secrets are sourced from **HashiCorp Vault** via the **External Secrets Operator (ESO)**.

## Model

```
Vault  ──(External Secrets Operator)──▶  Kubernetes Secret  ──(secretRefs / secretKeyRef)──▶  Pods
```

- `vault` (chart alias) — the secret backend. The dev compose stack runs Vault in `-dev` mode; production points ESO at your Vault.
- `eso` (chart alias) — the External Secrets Operator, which materializes Vault paths into namespaced Kubernetes Secrets.
- `config.secretRefs` — the chart's map of which existing Secret + keys feed each component.

## secretRefs

```yaml
config:
  secretRefs:
    postgresCredentials:    { existingSecret: in-falcone-postgresql, keys: [username, password, database] }
    mongoCredentials:       { existingSecret: in-falcone-mongodb,    keys: [username, password, database] }
    kafkaCredentials:       { existingSecret: in-falcone-kafka,      keys: [username, password] }
    objectStorageCredentials:{ existingSecret: in-falcone-storage,   keys: [access-key, secret-key] }
    identityClient:         { existingSecret: in-falcone-identity-client, keys: [client-id, client-secret] }
    gatewayTls:             { existingSecret: in-falcone-dev-api-tls, keys: [tls.crt, tls.key] }
```

To use an externally managed credential, set `existingSecret` to your Secret (and disable the in-cluster component if you're pointing at a managed service).

## Sensitive material is mounted by reference, never inlined

The platform never embeds secret values in manifests or values. Generated material is created as a Secret and consumed via `secretKeyRef`. For example, the MongoDB replica-set keyfile:

```bash
openssl rand -hex 24 | tr -d '\n' | \
  kubectl create secret generic falcone-mongodb-rs-key \
    --from-file=MONGODB_REPLICA_SET_KEY=/dev/stdin -n falcone
# referenced via secretKeyRef, not an inline value
```

> [!TIP]
> Avoid putting provider-shaped literals (e.g. `sk_live_…`, real cloud keys) even in test fixtures — secret scanners and push protection will reject the commit. Use clearly non-provider placeholders.

## Air-gapped registries

Air-gapped installs add a registry pull secret and CA bundle (`global.imagePullSecrets`, `global.privateRegistry.caBundleConfigMap`) — create these in the namespace before installing. See [Installation → Air-gapped](/guide/installation#air-gapped).

## TLS

Gateway TLS comes from the `gatewayTls` secret (`tls.crt` / `tls.key`); the active mode is set by `publicSurface.tls.mode`.
