# secrets Specification

## Purpose
TBD - created by archiving change add-vault-secret-consumption. Update Purpose after archive.
## Requirements
### Requirement: Workspace secrets are stored in and consumed from Vault

The control-plane SHALL store a workspace secret in HashiCorp Vault (KV v2) when it is set via
`POST /v1/functions/workspaces/{workspaceId}/secrets`, at a path derived from the verified caller's
tenant and the workspace (`{mount}/data/falcone/workspace-secrets/{tenantId}/{workspaceId}/{name}`),
so that no tenant or workspace can address another's secret path. Secret values SHALL be write-only
over the API: `GET`/`LIST` return metadata only (name, version), never the value.

At function deploy, the control-plane SHALL resolve a function's declared secret references by reading
them from Vault server-side and injecting them as environment variables into the function's runtime
(each reference maps to an env var named explicitly or defaulted to the UPPER_SNAKE form of the secret
name). A function SHALL receive only the secrets of its own tenant/workspace.

The Vault backend SHALL be optional: when `VAULT_ADDR`/`VAULT_TOKEN` are not configured the secrets
API reports the backend disabled and function deploys ignore secret references, so the default
(Vault-off) install is unchanged. The kind profile SHALL enable Vault via the non-cert-manager
self-signed TLS path (`deploy/kind/values-kind-vault.yaml`) and wire the control-plane to it without
adding any Vault footprint to the default (Vault-off) render.

#### Scenario: A secret set via the API is stored in Vault and isolated per tenant/workspace

- **WHEN** a caller sets a secret for its own workspace via the secrets API
- **THEN** the value is written to Vault at the caller's tenant/workspace path and a subsequent
  `GET`/`LIST` returns the name and version but not the value
- **AND WHEN** two different tenants set a secret of the same name
- **THEN** the secrets occupy distinct Vault paths and neither tenant can read the other's value

#### Scenario: A secret is made available to a function as an environment variable

- **WHEN** a function declares a secret reference and is deployed
- **THEN** the control-plane reads that secret's value from the caller's tenant/workspace Vault path
  and injects it into the function's runtime environment under the resolved env-var name
- **AND** a secret that does not exist is skipped (the deploy does not fail)

#### Scenario: The Vault backend is inert when not configured

- **WHEN** `VAULT_ADDR`/`VAULT_TOKEN` are not set
- **THEN** the secrets API reports the backend disabled (HTTP 501) and the default install renders no
  Vault workload or reference

