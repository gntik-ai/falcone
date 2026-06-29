# Workspace secrets — console screen and runtime convergence

Falcone stores **per-workspace function secrets** in the OpenBao KV v2 backend
(`deploy/kind/control-plane/vault-secrets.mjs`): a tenant sets a secret for a workspace, and at
function deploy the control-plane reads it server-side and injects it as an environment variable.
This page documents the **Workspace Secrets** console screen (`/console/workspace-secrets`,
`apps/web-console/src/pages/ConsoleWorkspaceSecretsPage.tsx`) and the runtime convergence that backs
it, where a tenant could previously manage these secrets only over the HTTP API / CLI.

The screen manages **only** `function_workspace_secret` resources for the **active workspace**. It is
distinct from the superadmin **Secret Rotation** pages (`/console/secrets`, the platform/tenant
rotation plane); those are a separate surface and are unchanged.

## Write-only values, end to end

Secret **values are write-only** — there is no read path on any layer:

- The API never returns a value. `POST` (create), `PUT` (replace), `GET` (metadata), `LIST`, and
  `DELETE` responses carry **only** the published `FunctionWorkspaceSecret` metadata; none contains
  the value. The value is resolvable **only** server-side at function deploy
  (`getValue`/`resolveEnv`), never through any secrets API response.
- The `secretsApi` console client (`apps/web-console/src/services/secretsApi.ts`) exposes **no
  value-returning method** — only list/metadata reads and create/replace/delete writes. Its read
  types carry no value field; only the write-request type carries `secretValue`.
- The screen's value input is **masked**, is **never pre-populated** from any read (including the
  replace form), and is **cleared from component state immediately after** a successful create or
  replace. No value is placed in the DOM, the URL/query string, or any client log/telemetry, and the
  screen offers no "reveal"/"show value" affordance.

## Metadata shape (no value, no version)

Every read/write response returns exactly the `FunctionWorkspaceSecret` metadata
(`apps/control-plane/openapi/families/functions.openapi.json`, `additionalProperties: false`):

```json
{
  "secretName": "db_password",
  "name": "db_password",
  "tenantId": "ten_acme",
  "workspaceId": "wrk_prod",
  "resolvedRefCount": 2,
  "timestamps": { "createdAt": "2026-06-24T10:00:00.000Z", "updatedAt": "2026-06-24T11:00:00.000Z" },
  "description": "production database password"
}
```

- `tenantId`/`workspaceId` are **derived server-side** from the verified principal and the URL
  workspace — never from the request body.
- `name` is retained as a **backward-compat alias** of `secretName` so pre-convergence callers keep
  working; it is the only tolerated extra. **No KV `version`** field is exposed (KV-v2 versioning is
  internal), and **no value** is ever present.
- `timestamps` are the OpenBao KV-v2 metadata times (`created_time`/`updated_time`).
- `description` is **non-secret** metadata accepted on write and returned on read (stored as a
  reserved key in the KV entry); it never causes the value to be returned.
- `resolvedRefCount` is an **advisory, best-effort** count of the workspace's deployed functions that
  reference the secret (used only for the pre-delete warning, never a delete gate). The kind runtime
  returns `0` when the count is not cheaply computable.
- The list response is `{ "items": [ <metadata>, ... ], "page": { "size": <items.length> } }`.

## POST is create-only; PUT replaces

The runtime is brought into agreement with the already-published catalog/OpenAPI (five
`function_workspace_secret` routes) — no public route is invented and no contract field is removed.

| Method | Path | Purpose | Success |
| --- | --- | --- | --- |
| GET | `/v1/functions/workspaces/{workspaceId}/secrets` | List the workspace's secrets (metadata only). | `200` |
| POST | `/v1/functions/workspaces/{workspaceId}/secrets` | **Create** a secret. Create-only. | `201` (metadata) |
| GET | `/v1/functions/workspaces/{workspaceId}/secrets/{secretName}` | Get one secret's metadata. | `200` (`404 SECRET_NOT_FOUND` if absent) |
| PUT | `/v1/functions/workspaces/{workspaceId}/secrets/{secretName}` | **Replace** the value at the same path. | `200` (metadata) |
| DELETE | `/v1/functions/workspaces/{workspaceId}/secrets/{secretName}` | Delete the secret (all versions). | `200` (kind runtime) / `204` (contract) |

- **`POST` is create-only.** When a secret of that name already exists in the workspace the
  control-plane returns **`409 SECRET_ALREADY_EXISTS`** and does **not** overwrite the stored value
  (the existing value is preserved). The console reports the conflict and directs the operator to
  **Replace**.
- **`PUT` replaces** the value at the same KV path (the prior version is superseded). The response
  carries the metadata with an updated timestamp and **no value**.
- The secret name must match `^[a-z][a-z0-9_-]{0,62}$`; the value must be a non-empty string of at
  most `65535` characters. The console validates both client-side before submitting.

## Tenant / workspace isolation

Every operation is **path-scoped** to the active workspace. The tenant and workspace are derived
server-side (`ownedWorkspace`) from the verified principal — a body-supplied `tenantId`/`workspaceId`
cannot redirect the scope. A caller whose verified tenant does not own the workspace receives
**`404 WORKSPACE_NOT_FOUND`** (no existence leak); the console renders this as a generic
"not available" state that never reveals another scope's secret names or existence. Authorization is
**server-authoritative** — the console adds only a coarse, fail-safe nav/route gate
(`apps/web-console/src/lib/workspace-secrets-access.ts`: workspace membership / tenant-admin /
platform role) and otherwise defers to the server `403`/`404`; it never client-trusts a mutation.

## Role authorization on writes

Tenant/workspace scoping (above) is **isolation**, not authorization: it proves *which* tenant a
caller belongs to, not *whether* the caller's role may mutate. Creating, replacing, or deleting a
secret therefore additionally requires an **administrative tenant role** — `tenant_owner` /
`tenant_admin`, or a platform/superadmin caller — enforced server-side by `canManageTenant`
(`deploy/kind/control-plane/tenant-scope.mjs`), the same coarse gate every other privileged
control-plane write uses. A non-admin tenant member (`tenant_developer`, `tenant_viewer`) that
belongs to the owning tenant receives **`403 FORBIDDEN`** on `POST` / `PUT` / `DELETE`, on **every**
workspace and **every** stage (dev / staging / **production** alike), and **nothing is
created/replaced/deleted**. This holds even though those roles can browse the page; the console's
`canManageWorkspaceSecrets` nav/route gate is defense-in-depth only and the server is the authority.

The gate fires **after** the tenant/isolation check, so a caller from another tenant still gets
`404 WORKSPACE_NOT_FOUND` (the `404` wins over the `403`) and the role check never leaks
own-tenant-vs-other-tenant existence. **Reads are not role-gated** — listing secret metadata
(`GET` list) and reading a secret's metadata (`GET` by name) remain available to any member of the
owning tenant (values are write-only regardless, per *Write-only values, end to end* above).

## Default-off backend (`501`)

The OpenBao backend is **optional and off by default**. When it is not configured
(`BAO_ADDR`/`BAO_TOKEN`, or the legacy `VAULT_ADDR`/`VAULT_TOKEN`, unset) every secret op returns
**`501 SECRETS_BACKEND_DISABLED`** and function deploys ignore secret references, so the default
install is unchanged. The console renders this as a **first-class "secrets backend unavailable"
state** (a single informational panel, not a repeating error toast). The kind profile enables the
backend via the self-signed TLS path (`deploy/kind/values-kind-vault.yaml`).

## Pre-delete reference-safety warning

Function deploy **silently skips** a missing secret reference, so deleting a referenced secret can
silently break a function's environment on its next deploy. Before deleting, the screen shows a
confirmation with a **reference-safety warning**:

- when `resolvedRefCount` is greater than zero, it states the number of referencing functions and
  that deleting the secret removes the injected env var on their next deploy;
- otherwise it shows a generic warning ("deleting this secret may break functions that reference it
  on their next deploy").

Deletion is never blocked by the reference count — the warning is advisory.

## Console states

The screen renders distinct, non-leaky states: **loading**; **empty** (naming the active workspace
and its environment); **client-side validation** (name pattern, non-empty value, `maxLength 65535`);
and distinct error rendering for `400` (validation), `404` secret (missing), `404` workspace (generic
"not available"), `409` (duplicate → directs to replace), `413` (value too large), `429`
(rate-limited), plan/`403` and authorization `403` (a clean auth error — the screen always defers to
the server for mutate authority), `501` (backend unavailable), and `502` (backend failure). The
active workspace's `environment` is shown as a stage badge (a production workspace shows a production
indicator); the list refreshes after every successful mutation.

## Auditing

Each mutation is auditable **server-side** with the secret **value redacted** (the OpenBao file-audit
pipeline sanitized by `services/secret-audit-handler/src/sanitizer.mjs`), capturing actor, tenant,
workspace, operation, and secret name. The console surfaces success/failure and makes the
`X-Correlation-Id` available for support, but emits **no secret value** to any client log or
telemetry.
