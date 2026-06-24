## MODIFIED Requirements

### Requirement: Workspace secrets are stored in and consumed from Vault

The control-plane SHALL **create** a workspace secret in the secrets backend (KV v2) when it is set via
`POST /v1/functions/workspaces/{workspaceId}/secrets`, at a path derived from the verified caller's
tenant and the workspace (`{mount}/data/falcone/workspace-secrets/{tenantId}/{workspaceId}/{name}`),
so that no tenant or workspace can address another's secret path. `POST` SHALL be **create-only**: when a
secret of that name already exists in the workspace the control-plane SHALL return `409` and SHALL NOT
overwrite the stored value (the existing value is preserved). To change an existing secret's value the
control-plane SHALL accept `PUT /v1/functions/workspaces/{workspaceId}/secrets/{secretName}`, which
**replaces** the value (idempotent at the same path; the prior version is superseded), gated identically
to the other secret operations. The `tenantId` and `workspaceId` SHALL be derived from the verified caller
and the workspace, **never** from the request body; a caller whose verified tenant does not own the
workspace SHALL receive `404 WORKSPACE_NOT_FOUND` (no existence leak), and a missing secret on
read/replace SHALL return `404 SECRET_NOT_FOUND`.

Secret values SHALL be **write-only** over the API: no response of any read or write operation
(`POST`/`PUT`/`GET`/`LIST`/`DELETE`) SHALL carry the secret value. The list, metadata, and write
responses SHALL return only the non-secret metadata of the published `FunctionWorkspaceSecret` schema —
`secretName` (with `name` retained as an alias for backward compatibility), `tenantId`, `workspaceId`,
`resolvedRefCount`, `timestamps` (created/updated), and an optional non-secret `description` — and SHALL
NOT add any field absent from that schema (it is `additionalProperties: false`; in particular no KV
`version` is exposed in any response body). `resolvedRefCount` SHALL be an **advisory, best-effort** count
of the workspace's deployed functions that reference the secret (computed from the function registry,
never a hard delete gate); `description` SHALL be non-secret metadata accepted on write and returned on
read, stored without ever causing the value to be returned. The secret name SHALL match
`^[a-z][a-z0-9_-]{0,62}$` and the value SHALL be a non-empty string of at most 65535 characters.

At function deploy, the control-plane SHALL resolve a function's declared secret references by reading
them from the secrets backend server-side and injecting them as environment variables into the function's
runtime (each reference maps to an env var named explicitly or defaulted to the UPPER_SNAKE form of the
secret name). A function SHALL receive only the secrets of its own tenant/workspace. The value-resolving
read path (`getValue`/`resolveEnv`) SHALL remain **server-side only** and SHALL NOT be reachable through
any secrets API response.

The secrets backend SHALL be optional: when the backend connection
(`VAULT_ADDR`/`VAULT_TOKEN`, or the canonical `BAO_ADDR`/`BAO_TOKEN`) is not configured the secrets API
reports the backend disabled (HTTP 501) and function deploys ignore secret references, so the default
(secrets-off) install is unchanged. The kind profile SHALL enable the backend via the non-cert-manager
self-signed TLS path (`deploy/kind/values-kind-vault.yaml`) and wire the control-plane to it without
adding any secrets-backend footprint to the default (secrets-off) render. Adding the `POST` create-only
conflict, the `PUT` replace operation, and the richer metadata SHALL bring the runtime into agreement with
the already-published public contract (the catalog's five `function_workspace_secret` routes and the
`FunctionWorkspaceSecret` schema) — no public route is added and no field of the **published contract** is
removed; the current runtime's legacy `name` field SHALL be retained as an alias so existing API/CLI
callers are not broken.

#### Scenario: A secret created via the API is stored and isolated per tenant/workspace

- **WHEN** a caller creates a secret for its own workspace via `POST …/secrets`
- **THEN** the value is written to the backend at the caller's tenant/workspace path and a subsequent
  `GET`/`LIST` returns the metadata (`secretName`, `tenantId`, `workspaceId`, `resolvedRefCount`,
  `timestamps`, and any `description`) but **not** the value
- **AND WHEN** two different tenants set a secret of the same name
- **THEN** the secrets occupy distinct backend paths and neither tenant can read the other's value

#### Scenario: POST create is create-only and conflicts on an existing name

- **WHEN** a caller `POST`s a secret whose name already exists in the workspace
- **THEN** the control-plane returns `409` and does **not** overwrite the stored value (the existing value
  is preserved), so changing a value requires the explicit `PUT` replace
- **AND WHEN** the caller `POST`s a name that does not yet exist in the workspace
- **THEN** the secret is created and `201` is returned with the secret metadata (no value)

#### Scenario: A secret value is replaced via PUT

- **WHEN** a caller that owns the workspace issues
  `PUT /v1/functions/workspaces/{workspaceId}/secrets/{secretName}` with a new value
- **THEN** the secret's value is replaced at the same path (the prior value is superseded) and the response
  returns the secret metadata with an updated timestamp and **no value** (no `version` field is exposed)
- **AND WHEN** the caller's verified tenant does not own the workspace
- **THEN** the request is denied with `404 WORKSPACE_NOT_FOUND` before any backend write (no existence
  leak), and the body's `tenantId`/`workspaceId`, if present, are ignored in favor of the server-derived
  scope

#### Scenario: No secrets API response ever carries the value

- **WHEN** any secret operation (`POST` create, `PUT` replace, `GET` metadata, `LIST`, `DELETE`) returns
- **THEN** the response carries only non-secret metadata and **no field contains the secret value**; the
  value can be obtained only server-side at function deploy (`getValue`/`resolveEnv`), never through the
  API

#### Scenario: A secret is made available to a function as an environment variable

- **WHEN** a function declares a secret reference and is deployed
- **THEN** the control-plane reads that secret's value from the caller's tenant/workspace backend path
  and injects it into the function's runtime environment under the resolved env-var name
- **AND** a secret that does not exist is skipped (the deploy does not fail)

#### Scenario: The secrets backend is inert when not configured

- **WHEN** the secrets-backend connection (`VAULT_ADDR`/`VAULT_TOKEN` or `BAO_ADDR`/`BAO_TOKEN`) is not set
- **THEN** the secrets API reports the backend disabled (HTTP 501) and the default install renders no
  secrets-backend workload or reference
