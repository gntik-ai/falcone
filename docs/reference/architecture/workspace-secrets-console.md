# Workspace secrets — console screen and runtime convergence

Falcone stores **per-workspace function secrets** in the OpenBao KV v2 backend
(`apps/control-plane/vault-secrets.mjs`): a tenant sets a secret for a workspace, and at
function deploy the control-plane reads it server-side and projects it into an owned Kubernetes
Secret. The workload receives environment variables through `valueFrom.secretKeyRef`.
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
(`apps/control-plane-executor/openapi/families/functions.openapi.json`, `additionalProperties: false`):

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
- `resolvedRefCount` counts distinct Functions with persisted declarations in this workspace,
  including Functions whose declared secret was subsequently deleted. Registry failures are errors,
  rather than a misleading zero. Declarations store names and env mappings, never values.
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
| DELETE | `/v1/functions/workspaces/{workspaceId}/secrets/{secretName}` | Delete the secret (all versions). | `204` (`404 SECRET_NOT_FOUND` if absent) |

- **`POST` is create-only.** When a secret of that name already exists in the workspace the
  control-plane returns **`409 SECRET_ALREADY_EXISTS`** and does **not** overwrite the stored value
  (the existing value is preserved). The console reports the conflict and directs the operator to
  **Replace**.
- **`PUT` replaces** the value at the same KV path (the prior version is superseded). The response
  carries the metadata with an updated timestamp and **no value**.
- **`DELETE` is contract-strict.** Deleting an existing secret returns **`204 No Content`** and no
  metadata body. Deleting a name that is not present in the workspace returns **`404 SECRET_NOT_FOUND`**
  without calling the delete backend.
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
(`apps/control-plane/tenant-scope.mjs`), the same coarse gate every other privileged
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

## Core OpenBao backend

OpenBao is part of the core platform baseline. Fresh installs configure `BAO_ADDR`, Kubernetes-auth
roles, and the OpenBao CA mount for the control-plane and executor, so workspace-secret operations
use OpenBao by default. `BAO_TOKEN` remains a break-glass/test path; normal workloads authenticate
with their ServiceAccount through OpenBao Kubernetes auth.

`501 SECRETS_BACKEND_DISABLED` is now a misconfiguration signal rather than the expected default
state. The console still renders it as a first-class "secrets backend unavailable" panel so an
operator sees a clear degraded-state message instead of repeating error toasts.

## Pre-delete confirmation and reference-safety

Function deploy rejects missing declared secrets. References use `optional: false`, so revocation
also prevents newly started pods from receiving an incomplete environment. Before deleting, the screen routes the
operation through the shared `DestructiveConfirmationDialog`:

- when `resolvedRefCount` is greater than zero, the dialog is **critical**, requires the operator
  to type the secret name, and lists the referencing function count in the cascade-impact section;
- when the active workspace is production (`production` or `prod`), the dialog is also **critical**
  and requires type-to-confirm even if no references are currently detected;
- otherwise the same shared dialog is used at warning level, keeping the confirmation semantics and
  error handling consistent with storage buckets, service accounts, functions, plans, and other
  high-consequence console actions.

Deletion is never blocked by the reference count — the warning is advisory.

The page owns the function-reference count; there is no separate admin cascade-impact endpoint for
workspace-secret metadata. The console passes that count as a static cascade-impact summary to the
shared destructive-operation hook so the canonical dialog can present it without issuing a synthetic
admin request.

## Console UX and accessibility hardening

The Workspace Secrets page follows the shared console UX conventions for page-level and row-level
state:

- an in-page breadcrumb (`Áreas de trabajo > <workspace> > Secretos`) mirrors the shell breadcrumb
  and keeps the leaf page navigable inside the page content;
- the active environment badge reuses the console context status-badge tone helper so production
  reads as restricted/destructive and non-production reads as neutral;
- create validation is per-field: invalid name and invalid value errors render in the same submit
  cycle, with `aria-invalid` and `aria-describedby` on the corresponding input, and no request is
  issued until both fields pass;
- create success remains near the create form, replace success is shown next to the affected secret
  row, and delete success is shown near the table/list region instead of being announced from the
  create card;
- the metadata table uses the shared `Table` primitive and responsive column priority instead of a
  hard `min-w-[64rem]` layout, so row labels, actions, and dynamic text do not force a laptop-width
  horizontal scroll as the only usable state.

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
pipeline sanitized by `packages/secret-audit-handler/src/sanitizer.mjs`), capturing actor, tenant,
workspace, operation, and secret name. The console surfaces success/failure and makes the
`X-Correlation-Id` available for support, but emits **no secret value** to any client log or
telemetry.

## Function Secret projection and lifecycle

Each Function owns one namespace-scoped Secret named `<ksvc-name>-secrets`. Its data contains only
resolved declarations from the Function's verified tenant/workspace. The tenant and Function
ownership labels match the Service; a controller owner reference binds the projection to its UID.
The control plane verifies labels and uses resourceVersion guards before adopting or replacing an
existing projection. It never adopts another Function's Secret. No secret value is included in
Service, Configuration, Revision, Deployment or ReplicaSet environment literals.

OpenBao remains the system of record. The Kubernetes Secret is derived runtime material, not a
second store for user-managed secrets and not a bypass of the external-secrets/OpenBao boundary.
The control plane does not persist resolved values in action rows, version snapshots, logs, audit
records or API responses. Actions and versions retain only the declared names and env mappings.
Rollback resolves those names against the current OpenBao values, rather than restoring old values.

Secret writes precede Service writes and fail closed. A denied or failed Secret write prevents the
Service mutation; there is no inline fallback. A failed Service creation rolls back a new Secret.
For a new Function, failure to complete rollback retains a Function record and cleanup obligation;
the error identifies the Function that can be deleted through the normal product API. For an
existing Function, a failed update or failed projection restore leaves its registry row, published
versions and lifecycle unchanged. The 502 `FN_DEPLOY_FAILED` response asks the caller to retry
deployment to reconcile the projection; it does not schedule Function deletion. Redeploy replaces
the entire data map, pruning dropped keys; an empty declaration deletes the projection.

Replace updates every consumer and rolls its Service template so new pods read the new value. It
returns metadata plus `affectedFunctions` (Function resource IDs). DELETE first revokes every
consumer projection, then removes the OpenBao entry. It retains the existing **204/no body** contract;
`x-falcone-affected-functions` contains a JSON array of affected Function IDs and
`x-falcone-resolved-ref-count` contains the number of consumers. Remaining declared refs are kept
for inventory and revocation warnings, including the deleted name in `fn_actions.secret_refs`.
A Function with only the revoked secret references a missing projection using `optional: false`
and fails closed when starting new pods. This is deliberate revocation behavior: ordinary deploy
and rollback reject missing declared source secrets before any runtime write. To resume, recreate
the source secret and redeploy, or redeploy with that declaration removed.

Replace and DELETE prune owned immutable Revisions containing legacy inline env literals. Their
foreground deletion removes their Deployment and ReplicaSet descendants. Both operations check all
five workload kinds before reporting success. The scan distinguishes user-provided literals from
Knative's injected user-container env and its queue-proxy container. Leaf projections use background
deletion with an absence check; Service and Revision cleanup retains foreground garbage collection.
Pending Knative reconciliation or garbage collection returns 502 with `pendingResources`; retry
the same replace/delete operation until it returns 200/204. Function deletion and tenant/workspace
purge also delete the owned projection, including when the Service is already missing. Unverified
cleanup retains logical ownership and a 202 deletion/cleanup obligation; retry Function DELETE or
the tenant/workspace purge API. A first Function DELETE can normally return 202 while foreground
garbage collection runs. There is no automatic reconciler for these obligations: the caller must
repeat the DELETE/purge request after GC completes. Ownership conflicts are retained and reported
rather than adopted.

An already-running process can retain the previous value in memory until its pod exits. Rotation
starts a new Revision, but operators should verify the reported Functions finish rolling or scale
them to zero. Kubernetes object cleanup does not revoke credentials at an external provider.

## Remediating existing inline Functions

Remediation is explicitly operator-triggered, with **dry-run as the default**. Run the shipped
`/app/remediate-function-secrets.mjs` in the control-plane runtime with its normal
scoped identity and database configuration. Do not supply secret values on the command line.

Discover affected Functions across the configured Function namespace without enumerating their IDs:

```sh
node /app/remediate-function-secrets.mjs --discover
```

Discovery paginates the labelled Function Services and checks each one's five owned object kinds.
It reports tenant IDs, Function resource IDs, Service names and affected object/env names, never
values or source code. It needs no database or OpenBao access and permits no apply or scope flags.
Unlabelled workloads are excluded; objects without a surviving owned Service need separate
operator investigation. Discovery does not automatically convert workloads.

For conversion, select a reported Function and use its registry tenant/workspace scope:

```sh
node /app/remediate-function-secrets.mjs --tenant-id TENANT --workspace-id WORKSPACE --resource-id FUNCTION
```

The report contains only object kinds/names and env names. It checks the owned Service and its
Configuration, Revision, Deployment and ReplicaSet descendants using UID ancestry; a matching
selector alone does not authorize deletion. Dry-run performs no writes and does not resolve values.

Old action rows did not retain declarations. Supply a JSON file containing the original names and
mappings, for example `[{"name":"api-key","env":"API_KEY"}]`, and add `--refs PATH --apply` to the
same command to convert them. Values are resolved only from the verified workspace in OpenBao.
Apply refuses unmapped legacy env names or missing secrets. It persists the declarations, replaces
the workload literals with references, prunes old Revisions, and rechecks all five kinds. A nonempty
`pending` report exits with status 2: rerun after controller reconciliation/foreground GC completes.
Migrate legacy Functions before relying on their consumer inventory for rotation or revocation.

The companion deployment change must grant namespace-scoped Secret create/get/update/patch/delete
without Secret list/watch, plus the bounded workload inspection and Revision deletion used for
legacy cleanup. Reverting that RBAC causes deploys to fail closed. Reverting to an older source
image can reintroduce inline values on its next deploy; coordinate rollback and remediation.

Deploy, rollback, Function deletion, secret replacement/revocation, and remediation serialize per
workspace. PostgreSQL advisory locks coordinate control-plane replicas across resolution, runtime
writes and registry persistence, so an in-flight deploy cannot republish a value after revocation.
