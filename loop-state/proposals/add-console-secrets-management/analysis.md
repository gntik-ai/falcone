# Analysis — Manage workspace secrets in the web console

Stage: ANALYZE (requirements foundation — no implementation, no OpenSpec change). Grounded in source.

## 1. Problem / Why
Falcone ships a **workspace secrets-as-a-service** backend (OpenBao KV v2; feature `add-vault-secret-consumption`/#612; backend swapped Vault→OpenBao in `replace-vault-with-openbao`/#720). A tenant can create/list/inspect-metadata/delete per-workspace secrets **today, but only over the HTTP API / CLI**. The console has **no working secrets screen**: `ConsoleSecretsPage.tsx` + `ConsoleSecretRotationPage.tsx` render **hard-coded mock rows** and target a *different, superadmin-only* API — the platform/tenant secret-**rotation** lifecycle (`/v1/platform/secrets/{domain}/{name}/...`) — not the workspace-secret CRUD API. They are unwired, not in the sidebar, and the `/console/secrets` route is currently ungated. Impact: tenant users/developers (P2/P3) must drop to `curl`/SDK to set function env secrets (function deploy injects them via `resolveEnv`); the console (P16) shows a misleading placeholder.

## 2. Scope (resolved)
**In:** a Workspace Secrets screen bound to the active tenant+workspace (`console-context.tsx` tracks `activeTenantId`/`activeWorkspaceId`; workspace carries `environment` = stage); CRUD on `/v1/functions/workspaces/{workspaceId}/secrets[...]` (list, create, update/replace, delete, metadata-view); a new console API client mirroring `services/functionsApi.ts`; a sidebar nav entry + role gating; full empty/loading/error/validation states incl. `501 SECRETS_BACKEND_DISABLED`.
**Out:** the platform/tenant **rotation** lifecycle (superadmin plane the existing mock targets); **reading back a stored plaintext value** (write-only hard invariant); managing the OpenBao backend / audit pipeline / function `secretRefs` wiring; any cross-tenant/cross-workspace multi-scope admin view.

**"Any kind of user" resolved (crux)** — per public-route-catalog `audiences` (`workspace_owner`, `workspace_admin`, `workspace_developer`, `platform_team`) + runtime `ownedWorkspace` gate:

| Secret class | Backend | May MANAGE | Scope |
|---|---|---|---|
| **Workspace function secrets** (this feature) | OpenBao via CP `secretSet/List/Get/Delete` | principal whose **verified tenant owns the workspace** (tenant owner/admin, workspace_developer); superadmin/platform_team cross-tenant | tenant+workspace (path `…/{tenantId}/{workspaceId}/{name}`); stage = workspace `environment` |
| platform/iam/gateway/tenant rotation secrets (OUT) | provisioning-orchestrator rotation API | superadmin/platform_team only | platform-global / per-tenant |

→ "any user" = **any operator of the workspace in context** may manage *that workspace's* secrets — NOT another tenant's/workspace's, NOT platform-domain secrets.

## 3. Affected personas & capabilities
Personas: **P16** (web console, primary), **P2/P3** (tenant user/developer actors), **P26** (OpenBao store: write on create/update, delete removes all versions, read = metadata only), **P7/P19** (security/isolation, top priority); superadmin/platform_team only for cross-tenant/rotation.
Areas: secrets-as-a-service (workspace function secrets; `vault-secrets.mjs` + `fn-handlers.mjs::secret*`; `resourceType function_workspace_secret`); web console (page + client + router gating + nav); identity/RBAC (Keycloak session; gate via `session.principal.platformRoles` + route `audiences`; CP principals **tenant-scoped — no `workspace_id` in JWT**, workspace in path, authorized via `ownedWorkspace`); audit (OpenBao→`secret-audit-handler`, value redacted, fail-closed).

## 4. Candidate requirements (normative; not yet final EARS)
**Screen & CRUD** — (1) list secrets (name+metadata only) via `GET …/secrets`; (2) create `POST …/secrets` `{secretName, secretValue}` (+optional `description`) with required `Idempotency-Key`; (3) update/replace (contract `PUT …/secrets/{name}`) + delete (`DELETE`) with delete confirmation; (4) metadata-only detail (`GET …/secrets/{name}`).
**Write-only value semantics (security-critical)** — (5) values write-only: never display/log/persist/re-fetch a stored value (contract: response schema has no value field; `secretValue` is `writeOnly:true`; runtime `secretGet`→`{name,version}`); (6) value input masked, never pre-populated from a GET, cleared after submit; (7) defense-in-depth — no console-reachable API returns a value; the console never invokes server-side-only `getValue` (function-deploy only).
**Tenant+workspace+stage scoping** — (8) every call scoped to the active workspace id in the **path**; tenant/workspace derived server-side from the verified principal (`ownedWorkspace`), never from body; (9) require a selected workspace before any op (no implicit "all workspaces"); (10) no UI to address secrets across workspaces/tenants in one view.
**RBAC** — (11) screen + nav gated to route `audiences` (workspace owner/admin/developer for their tenant; superadmin/platform_team); others don't see nav or reach route (redirect, mirroring `RequireSuperadminRoute`); (12) distinguish read (list/metadata) from mutate — read-only role has create/update/delete hidden/disabled, server `403` surfaced as auth error.
**Audit** — (13) every mutating action yields a server-side audit event with actor/tenant/workspace/operation/secret-name, value redacted; console never includes value in client telemetry.
**States & validation** — (14) validate `secretName` `^[a-z][a-z0-9_-]{0,62}$` + non-empty value (`maxLength 65535`); render `400`/`409`(dup)/`404`/`413`/`429` distinctly; (15) `501 SECRETS_BACKEND_DISABLED` → explicit "backend unavailable" state; (16) distinct loading/empty/error states, refresh after mutate.
**Consistency** — (17) console client matches the live contract exactly (paths/methods/headers incl. `X-API-Version`/`X-Correlation-Id`/`Idempotency-Key`); where kind runtime diverges from catalog (§6 Q1) the architect picks the authoritative side.

## 5. Key scenarios (WHEN/THEN) — isolation/authz first
- **S1 create (happy):** workspace owner of T, W selected, submits `db-password`+value → POST → `201` metadata (no value), value cleared, list refreshes.
- **S2 list metadata-only:** screen loads → names/metadata, DOM contains **no secret value**.
- **S3 update+delete:** PUT new value, DELETE after confirm → `200`, list reflects, no value shown.
- **S4 cross-tenant IDOR denied:** tenant B targets a workspace id owned by A → `404 WORKSPACE_NOT_FOUND` (no existence leak via `ownedWorkspace`); not-found shown, never A's names.
- **S5 cross-workspace:** tenant A, W1 selected → W2's secrets (even same tenant) not listed; switching active workspace required.
- **S6 read-only denied mutation:** viewer principal → create/update/delete hidden/disabled; forced mutate → `403` as auth error.
- **S7 value never leaks:** any list/detail render → no response field carries a value; DOM/network never contain stored plaintext.
- **S8 platform-domain not manageable here:** tenant user has no console path to create/rotate/revoke `platform|iam|gateway` secrets; rotation API as tenant user → `403 TENANT_ISOLATION_VIOLATION` (`assertSecretRotationOwnership`).
- **S9 validation:** invalid name (`DB_PASSWORD`, leading digit, >63) or empty value → blocked client-side; if bypassed → `400 VALIDATION_ERROR`.
- **S10 duplicate:** existing name → `409` (no silent overwrite without explicit update).
- **S11 backend disabled:** OpenBao unconfigured → `501 SECRETS_BACKEND_DISABLED` → explicit "unavailable" state.
- **S12 audit on mutate:** create/delete success → sanitized audit event (actor/tenant/workspace/op/name, value redacted).

## 6. Open questions / risks for the architect
**Resolved by code (findings):**
- **`secretGet` does NOT leak the value** — returns `{name, version}` (uses `getMeta`, never `getValue`); OpenAPI `FunctionWorkspaceSecret` has no value field; `secretValue` `writeOnly:true`. Plaintext resolvable only server-side at deploy (`getValue`/`resolveEnv`). Write-only is already a backend invariant — the UI preserves it.
- **Error semantics:** cross-tenant/missing workspace → `404 WORKSPACE_NOT_FOUND`; missing secret → `404 SECRET_NOT_FOUND`; backend off → `501`; bad name/value → `400`; OpenBao failure → `502`.
- **Existing console secrets pages are the WRONG plane** for "any user" (they mock superadmin rotation). Build the workspace-secrets screen as a **distinct page/route**; leave/relabel the rotation mock.

**Genuine open questions (none individually blocking):**
- **Q1 — Contract↔runtime drift.** Catalog/OpenAPI advertise a `PUT …/secrets/{name}` (replace) + metadata `description/resolvedRefCount/timestamps/tenantId/workspaceId`; the kind runtime exposes only POST/GET-list/GET-meta/DELETE returning `{name,version}`. Implement the contract (add PUT + richer metadata in kind CP) or trim the UI? Recommend implementing the contract (POST is already an OpenBao upsert).
- **Q2 — Stage scoping.** Workspace IS the stage unit (`workspace.environment`); a secret is per-stage because per-workspace. Confirm UI models stage as the selected workspace's environment (no extra dimension exists).
- **Q3 — Min role to mutate vs read.** Catalog `audiences` = workspace owner/admin/developer/platform_team, but the console's only built-in guard is superadmin-vs-not. Define the exact gate (list = any member, mutate = owner/admin/developer?) and verify what workspace-role signal the console session carries (it exposes `platformRoles`; workspace roles may be absent).
- **Q4 — Per-workspace secret quota.** No count/size cap found. If one exists/should, add quota-exhausted/`429` state + count indicator.
- **Q5 — Naming + delete safety.** Name maps to an `UPPER_SNAKE` env var (`secretEnvVarName`). Deleting a referenced secret silently no-ops in function deploy (missing refs skipped → a delete can silently break a function's env). Show the env-var name + `resolvedRefCount` + pre-delete warning.
- **Q6 — Idempotency-Key.** Create requires `Idempotency-Key`; confirm the console session client generates one per create.

## Key source references (path::symbol)
- Routes: `deploy/kind/control-plane/routes.mjs` L256–260 (`secretSet/secretList/secretGet/secretDelete`, `auth:'authenticated'`).
- Handlers + isolation gate: `deploy/kind/control-plane/fn-handlers.mjs` L59–66 (`ownedWorkspace`), L268–315 (secret handlers), L83–87 (`callerTenantId`).
- Backend store (write-only, path isolation): `deploy/kind/control-plane/vault-secrets.mjs` (`workspaceSecretPath` L28, `getMeta` L118, `getValue` L124 server-only, `SECRET_NAME_RE` L98).
- Contract (authoritative): `services/internal-contracts/src/public-route-catalog.json` L5500–5860 (`function_workspace_secret`, `audiences`, `scope:workspace`, `tenant/workspaceBinding:required`).
- Contract schemas: `apps/control-plane/openapi/families/functions.openapi.json` (`FunctionWorkspaceSecretWriteRequest` `secretValue writeOnly:true`; `FunctionWorkspaceSecret` no value field; `updateFunctionWorkspaceSecret` PUT).
- Console mock pages (WRONG plane = rotation): `apps/web-console/src/pages/ConsoleSecretsPage.tsx`, `ConsoleSecretRotationPage.tsx`, `apps/web-console/src/actions/secretRotationActions.ts`.
- Console routing + RBAC: `apps/web-console/src/router.tsx` L56–64, L91–95 (`RequireSuperadminRoute`), L282–288 (ungated `secrets` route).
- Console tenant/workspace/stage context: `apps/web-console/src/lib/console-context.tsx` (`activeTenantId/activeWorkspaceId`, `Workspace.environment`).
- Console nav (no secrets entry): `apps/web-console/src/layouts/ConsoleShellLayout.tsx`.
- Client pattern to mirror: `apps/web-console/src/services/functionsApi.ts`.
- Out-of-scope rotation plane + isolation gate: `services/provisioning-orchestrator/src/actions/secret-path-ownership.mjs` (`assertSecretRotationOwnership`, `TENANT_ISOLATION_VIOLATION`).
- Audit redaction: `services/secret-audit-handler/src/sanitizer.mjs`.
