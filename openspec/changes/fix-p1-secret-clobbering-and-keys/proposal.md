## Why

Three Helm charts create Kubernetes Secrets with empty-string defaults that
overwrite operator-provisioned values on every `helm upgrade`, plus a
stand-alone manifest that ships a literal placeholder AES key. From
`openspec/audit/cap-p1-helm-charts-and-kubernetes-manifests.md`:

- **B5** (`charts/realtime-gateway/templates/secret-ref.yaml:6-9`,
  `charts/workspace-docs-service/templates/secret.yaml:6-9`,
  `helm/charts/backup-status/templates/secret.yaml:9-12`) — three chart
  templates create real Secrets whose keys default to `""`. On `helm
  upgrade`, any externally-rotated value (via ESO or kubectl) is overwritten
  with empty strings.
- **B8** (`deploy/k8s/encryption-config.yaml:14`) — `secret:
  REPLACE_WITH_BASE64_32_BYTE_KEY`. No automation substitutes the
  placeholder. Applying as-is causes apiserver decode failure.
- **B15** (`helm/charts/backup-status/values.yaml:24-28, secret.yaml:10-12`)
  — `DB_URL`, `KAFKA_BROKERS`, `KEYCLOAK_JWKS_URL` all default to `""` and
  the Secret interpolates them; backup-status runs against empty connection
  strings on default install.
- **G11** restates B5; **G12** restates B8.

## What Changes

- Remove the three `secret-ref.yaml` / `secret.yaml` templates that create
  Secrets from empty defaults; require operators to provision the Secret
  out-of-band via ESO. Keep a `secret-reference.yaml` ConfigMap fragment
  that asserts the Secret name and key list the workload mounts.
- Move secret name resolution into each chart's values file as
  `existingSecret: <name>` so the workload references a Secret it does not
  manage.
- Replace the literal `REPLACE_WITH_BASE64_32_BYTE_KEY` in
  `deploy/k8s/encryption-config.yaml` with a `# generated` placeholder
  blocked by a pre-apply script; add `scripts/render-encryption-config.sh`
  that generates a real 32-byte key and writes the rendered manifest.

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: requirement that no chart creates a Secret
  whose defaults overwrite externally-provisioned values, and no stand-alone
  manifest ships a literal placeholder key as production artefact.

## Impact

- **Affected code**: delete
  `charts/realtime-gateway/templates/secret-ref.yaml`,
  `charts/workspace-docs-service/templates/secret.yaml`,
  `helm/charts/backup-status/templates/secret.yaml`; modify
  `deploy/k8s/encryption-config.yaml`; add
  `scripts/render-encryption-config.sh`.
- **Migration required**: operators must provision the four Secrets
  (realtime-gateway, workspace-docs-service, backup-status, encryption-config)
  via ESO or a pre-install step; the umbrella ESO subchart already declares
  the first three patterns under `eso/templates/*.yaml`.
- **Breaking changes**: `helm install` of the three sidecar charts now
  requires the Secret to exist; intended.
