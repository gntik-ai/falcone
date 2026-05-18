## Why

The Vault subchart is a single point of permanent data loss for the entire
secret tier. The init Job extracts root token + 5 unseal keys, uses them
once, and discards them; Vault runs single-replica on file-backed storage.
If the Vault pod dies and the PVC is lost, every secret is permanently
inaccessible. From
`openspec/audit/cap-p1-helm-charts-and-kubernetes-manifests.md`:

- **B11** (`charts/in-falcone/charts/vault/templates/vault-init-job.yaml:25-32`)
  — init Job calls `vault operator init` with 5 key-shares / 3-threshold,
  extracts via `sed` regex, uses the root token + unseal keys immediately,
  then discards them. No persistence to a Kubernetes Secret, no escrow to
  an external KMS, no operator copy.
- **G9** restates B11 in the SPOF framing: combined with `replicas: 1`
  (Vault `values.yaml:3`) and file-backend storage
  (`vault-config-configmap.yaml:8-9`), Vault cannot be unsealed manually
  after a pod loss.

## What Changes

- Add a `vault.unsealKeyEscrow.mode` value with three options:
  - `kubernetesSecret` (default): the init Job writes the root token and
    each unseal key share to a per-key Kubernetes Secret in a separate
    `vault-escrow` namespace with strict RBAC (only the `vault-operator`
    ServiceAccount can read).
  - `kms`: the init Job seals each key share with a KMS-backed Helm value
    `unsealKeyEscrow.kms.publicKey` and writes the ciphertext to a
    Kubernetes Secret; decryption requires the matching KMS private key
    held outside the cluster.
  - `external`: the init Job pipes the raw output to a Helm-supplied
    webhook URL and exits with non-zero on any error; the operator is
    responsible for collection.
- Document the SPOF risk in the chart README and require the operator to
  pick a mode at install time (validator fails if `mode` is unset).
- Raise the default replica count in the `ha` profile values overlay to 3
  (Vault HA with the integrated storage backend; out of scope here but
  cross-referenced).

## Capabilities

### Modified Capabilities

- `deployment-and-operations`: requirement that the Vault subchart escrow
  unseal keys to a recoverable location; install MUST fail when the mode is
  unset.

## Impact

- **Affected code**:
  `charts/in-falcone/charts/vault/templates/vault-init-job.yaml`,
  `charts/in-falcone/charts/vault/templates/vault-escrow-rbac.yaml` (new),
  `charts/in-falcone/charts/vault/values.yaml`,
  `charts/in-falcone/templates/validate.yaml`.
- **Migration required**: existing installs must run a one-time
  re-initialisation that escrows the current keys (or accept that a Vault
  pod loss is unrecoverable).
- **Breaking changes**: `vault.unsealKeyEscrow.mode` MUST be supplied;
  install fails when omitted.
