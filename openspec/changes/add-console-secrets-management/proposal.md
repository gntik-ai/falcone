# Change: add-console-secrets-management

## Why

Falcone already ships **workspace secrets-as-a-service** for functions (OpenBao KV v2;
`add-vault-secret-consumption`/#612, backend swapped to OpenBao in `replace-vault-with-openbao`/#720).
A tenant can create / list / inspect-metadata / delete per-workspace secrets **today, but only over the
HTTP API or CLI** — there is **no working console screen**. The two existing console pages
(`apps/web-console/src/pages/ConsoleSecretsPage.tsx`, `ConsoleSecretRotationPage.tsx`) render
**hard-coded mock rows** and target a *different, superadmin-only* plane — the platform/tenant
secret-**rotation** lifecycle (`/v1/platform/secrets/{domain}/{name}/...` via a bare `fetch` with **no
auth header**). They are unwired, absent from the sidebar, and the `/console/secrets` route is currently
**ungated**.

Impact (personas): the web console (**P16**, primary) shows a misleading placeholder; tenant
users / developers (**P2/P3**) must drop to `curl`/SDK to set the function env secrets that function
deploy injects via `resolveEnv`; the OpenBao store (**P26**) is exercised only headlessly; and the
security/isolation surface (**P7/P19**) has no UI-side discipline for the write-only and per-workspace
isolation invariants. The resolved audience ("any kind of user") is **any operator of the workspace in
context** — a principal whose **verified tenant owns the workspace** (tenant owner/admin,
workspace developer; superadmin/platform_team cross-tenant) — managing **that workspace's** secrets,
NOT another tenant's/workspace's, and NOT the platform-domain rotation secrets.

There is also a contract↔runtime drift to close: the published catalog
(`services/internal-contracts/src/public-route-catalog.json`) and OpenAPI
(`apps/control-plane/openapi/families/functions.openapi.json`) advertise **five**
`function_workspace_secret` routes (GET-list, POST, GET-meta, **PUT-update**, DELETE) returning the
richer `FunctionWorkspaceSecret` metadata (`secretName`, `tenantId`, `workspaceId`, `resolvedRefCount`,
`timestamps`, optional `description`), while the kind control-plane runtime
(`deploy/kind/control-plane/routes.mjs`, `fn-handlers.mjs::secret*`) serves only **four** ops returning
`{name, version}`. Building a console to the published contract requires the runtime to **match** it.

## What Changes

- **NEW console capability (`web-console`).** Add a **Workspace Secrets** screen bound to the active
  tenant + workspace (`console-context.tsx` `activeTenantId`/`activeWorkspaceId`; stage = the active
  workspace's `environment`). It lists secrets (**names/metadata only — never a value**), creates,
  updates/replaces, deletes (with a confirmation that includes a reference-safety warning), and shows a
  metadata detail. The screen is reached by a new sidebar nav entry and a **fail-safe route guard**
  (coarse workspace-membership / tenant-admin / platform gate, redirecting non-members), and renders
  distinct **loading / empty / validation / authorization-denied / error / `501 SECRETS_BACKEND_DISABLED`**
  states. Secret values are **write-only in the UI**: masked input, never pre-filled from any read,
  cleared from component state after submit, never placed in the DOM/URL/logs/telemetry.

- **NEW console data client `secretsApi`.** A TypeScript client (mirroring
  `apps/web-console/src/services/functionsApi.ts`) built on the existing console HTTP layer
  (`requestConsoleSessionJson` → `http.ts`), so it **inherits** `Idempotency-Key` (auto on non-GET),
  `X-API-Version`, `X-Correlation-Id`, the `Authorization` bearer, and 401-refresh-retry. It calls
  **only** the five advertised `function_workspace_secret` routes and exposes **no value-returning
  method** (none exists server-side; `getValue`/`resolveEnv` are server-only at deploy).

- **MODIFIED runtime (`secrets`).** Converge the kind control-plane runtime with the published contract:
  make `POST` **create-only** (`409` on an existing name, no overwrite), add
  `PUT /v1/functions/workspaces/{workspaceId}/secrets/{secretName}` for **replace** (idempotent at the same
  KV-v2 path), and return the advertised `FunctionWorkspaceSecret` metadata — exactly
  `{secretName, tenantId, workspaceId, resolvedRefCount, timestamps, optional description}` (the schema is
  `additionalProperties: false`, so **no** extra field, in particular **no** KV `version`, is added to any
  response) — on the write/list/metadata responses, while keeping the value **strictly write-only** (no
  response field on any read or write path carries a value). This brings the runtime into agreement with
  the already-published OpenAPI/catalog (no new public route is invented and no catalog/OpenAPI edit is
  needed; `npm run generate:public-api` SHOULD therefore stay a no-op diff, which confirms only that **no
  contract edit** was made — it round-trips the OpenAPI doc and never inspects the kind runtime, so actual
  runtime↔contract agreement is proven by the live kind+OpenBao verification, not by the generator). This
  is the contract-vs-runtime convergence pattern this repo repeatedly applies (#683, #676, #673).

- **Isolation / authz are server-authoritative.** Every secret op is **path-scoped** to the active
  workspace; the tenant and workspace are **derived server-side** from the verified principal
  (`ownedWorkspace`/`callerTenantId`), **never** from client input. Cross-tenant / cross-workspace access
  is denied with **`404`** (no existence leak). The console adds only a coarse membership nav/route gate
  (defense-in-depth, fail-safe) and otherwise **defers to the server** `403`/`404`; it never client-trusts
  a mutate decision. The console session principal carries no per-workspace role, so the spec does **not**
  claim a client-side viewer-vs-developer block — the server is the **sole** mutate authority.

## Impact

- **Affected capabilities:** `web-console` (**ADDED** — the screen, client, route, nav entry, RBAC guard,
  write-only handling, and all states) · `secrets` (**MODIFIED** — kind CP runtime adds PUT + the
  advertised metadata, write-only preserved). `functions` is **untouched** (workspace-secret storage is
  owned by the `secrets` capability). Nothing is **REMOVED**.
- **Affected backend (kind control-plane runtime) — extend existing modules only (no new `.mjs` file, so
  the kind-CP Dockerfile COPY list is unchanged):**
  - `deploy/kind/control-plane/routes.mjs` — one new route
    `PUT /v1/functions/workspaces/{workspaceId}/secrets/{secretName}` → `localHandler:'secretReplace'`,
    `auth:'authenticated'`.
  - `deploy/kind/control-plane/fn-handlers.mjs` — new `secretReplace` (mirrors `secretSet`, replace
    semantics, `ownedWorkspace` gate, name/value validation); widen `secretSet`/`secretList`/`secretGet`
    (and `secretReplace`) responses to the advertised metadata shape.
  - `deploy/kind/control-plane/vault-secrets.mjs` — extend the store to surface KV-v2 metadata timestamps,
    accept + return a non-secret `description`, and compute/carry `resolvedRefCount` (best-effort from the
    workspace's `fn_actions` secret refs), while keeping `value` strictly write-only.
- **Affected contract:** none changed — the runtime is brought into agreement with the **already-published**
  `services/internal-contracts/src/public-route-catalog.json` (5 `function_workspace_secret` routes) and
  `apps/control-plane/openapi/families/functions.openapi.json` (`FunctionWorkspaceSecret*` schemas).
- **Affected frontend:** new `apps/web-console/src/pages/ConsoleWorkspaceSecretsPage.tsx`, new
  `apps/web-console/src/services/secretsApi.ts`, a new route + `RequireWorkspaceSecretsRoute` guard in
  `apps/web-console/src/router.tsx`, and a new gated nav entry in
  `apps/web-console/src/layouts/ConsoleShellLayout.tsx`.
- **Datastores:** OpenBao KV v2 only — **no new table**. `description` rides in the existing KV entry
  (reserved non-secret key) or KV custom-metadata; `timestamps` come from KV metadata; `resolvedRefCount`
  is **computed** from the existing `fn_actions` registry, not stored. Deletes remove **all versions**
  (unchanged).
- **Backward compatibility:** no public-contract break — PUT + metadata make the runtime **match** the
  OpenAPI (additive); `name` is **kept** as an alias alongside `secretName` so existing callers reading
  `{name, version}` still work; the mock rotation pages are **untouched** (only a nav relabel disambiguates
  them); the backend stays **off by default** → `501`. This change does **not** rename Vault→OpenBao
  (that is #720's concern); any stale "Vault" wording in the archived `secrets` spec body is a separate
  #720 sync cleanup.
