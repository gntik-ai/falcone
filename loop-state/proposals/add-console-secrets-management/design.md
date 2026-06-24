# Design — Manage workspace secrets in the web console

Stage: ARCHITECT (design only — no OpenSpec change, no implementation). Builds on `analysis.md`.
All behavioral facts are grounded in source (`path::symbol`); the code-only rule applies.

This document hands the spec-author an exact, OpenSpec-ready partition: which capability specs are
ADDED vs MODIFIED, the Q1–Q6 decisions, the per-layer impact, the mandatory cross-cutting SHALL
constraints, the recommended alternative, the risks, and backward-compatibility.

---

## 0. Ground truth confirmed by code (the decisions rest on these)

| Fact | Evidence |
|---|---|
| Runtime serves only **4** secret ops: POST-create, GET-list, GET-meta, DELETE. **No PUT.** | `deploy/kind/control-plane/routes.mjs` L257–260; `fn-handlers.mjs::secretSet/secretList/secretGet/secretDelete` L268–315 |
| Runtime field names are `name` (not `secretName`); responses carry **no** `tenantId`/`workspaceId`/`resolvedRefCount`/`description`/`timestamps`. POST→`{name,version,updatedAt}`, GET-list→`{items:[{name}],page:{total}}`, GET-meta→`{name,version}`, DELETE→`{name,deleted:true}` | `fn-handlers.mjs` L279, L290, L302, L313; `vault-secrets.mjs::createWorkspaceSecretStore` L109–137 |
| **Advertised contract** is richer: GET-list, POST, GET-meta, **PUT-update**, DELETE — 5 ops; response schema `FunctionWorkspaceSecret` requires `{secretName, workspaceId, tenantId, resolvedRefCount, timestamps}` + optional `description`; write req `{secretName, secretValue(writeOnly,1..65535), description?}` | `services/internal-contracts/src/public-route-catalog.json` (5 `function_workspace_secret` routes); `apps/control-plane/openapi/families/functions.openapi.json` schemas `FunctionWorkspaceSecret*` |
| Write-only is already a backend invariant: `secretGet` uses `getMeta` (never `getValue`); `secretValue` is `writeOnly:true`; no response schema has a value field; plaintext resolves **only** server-side at deploy via `resolveEnv`→`getValue` | `vault-secrets.mjs::getMeta` L118, `getValue` L124 (server-only), `resolveEnv` L142; `fn-handlers.mjs::fnDeploy` L131–140 |
| Isolation gate: `ownedWorkspace(ctx, workspaceId)` returns `null` on cross-tenant → handlers return `404 WORKSPACE_NOT_FOUND` (no existence leak). Path is `{mount}/data/falcone/workspace-secrets/{tenantId}/{workspaceId}/{name}`; **tenantId is derived from the verified caller**, never the body | `fn-handlers.mjs::ownedWorkspace` L59–66, `callerTenantId` L83–87; `vault-secrets.mjs::workspaceSecretPath` L28 |
| Backend optional: when `BAO_ADDR`/`BAO_TOKEN` (or legacy `VAULT_*`) unset → `vaultStore === null` → every secret handler returns `501 SECRETS_BACKEND_DISABLED` | `vault-secrets.mjs::vaultStoreFromEnv` L166–178; `fn-handlers.mjs` L269/285/296/308 |
| Console session principal carries **only** `platformRoles`, `tenantIds`, `workspaceIds` — **no per-workspace role** | `apps/web-console/src/lib/console-auth.ts::ConsoleSessionPrincipal` L52–61 |
| Console HTTP layer **already auto-injects** `X-API-Version`, `X-Correlation-Id`, and (for any non-GET or `idempotent:true`) `Idempotency-Key` via `crypto.randomUUID()` | `apps/web-console/src/lib/http.ts` L40–55 |
| Console functions client pattern to mirror: `requestConsoleSessionJson(url, {method, body})` (adds Bearer + 401-refresh-retry on top of `http.ts`) | `apps/web-console/src/services/functionsApi.ts`; `console-session.ts::requestConsoleSessionJson` L207, `performAuthenticatedRequest` L286 |
| Existing console "secrets" pages are the WRONG plane (superadmin platform/tenant **rotation**), mock rows, raw `fetch` to `/v1/platform/secrets/{domain}/{name}/...` with **no auth header**, route `/console/secrets` currently **ungated** | `apps/web-console/src/pages/ConsoleSecretsPage.tsx` (hard-coded `items`), `actions/secretRotationActions.ts` L53–92; `router.tsx` L282–288 |
| Nav shell `navItems` is a static `{label,to,icon,description?}` array with **no role/guard field** and no per-item role filtering; principal roles are available in the shell (`session.principal.platformRoles`) | `apps/web-console/src/layouts/ConsoleShellLayout.tsx` navItems block; `principalRoles` L190 |
| **No per-workspace secret count/size quota exists** anywhere (runtime or services). The only enforced write-path limits are value `maxLength 65535`, gateway `maxRequestBodyBytes 1048576` (→413), `rateLimitClass data-write`/`qosBurst 30` (→429), and `planCapabilityAnyOf:['data.openwhisk.actions']` (plan gate) | grep across `deploy/kind/control-plane` + `services` (only rotation grace-period bounds found); catalog POST/PUT route attrs |
| The live archived `secrets` capability spec text still says "Vault" (the `replace-vault-with-openbao` MODIFIED delta lives in the change dir; the archived spec body was not re-synced to OpenBao wording) | `openspec/specs/secrets/spec.md` (says "HashiCorp Vault"); cf. `openspec/changes/replace-vault-with-openbao/specs/secrets/spec.md` (says "OpenBao") |

---

## 1. Capability framing & spec partitioning — ADDED vs MODIFIED

Three real, existing capability specs are touched. Use these **exact ids** (`openspec list --specs`): `web-console`, `secrets`, `functions`. Do **not** invent a `console-secrets` capability.

### 1a. `web-console` — **ADDED** requirements (the UI is genuinely new)
The Workspace Secrets screen, its route, its nav entry, its RBAC guard, its write-only/empty/error/501
states, and the new `secretsApi` client are **net-new console capability**. The `web-console` spec today
has 4 requirements (tenant-create path, E2E cross-tenant probe, operator shell, session whoami) — none
covers a secrets screen. So this is **ADDED Requirements** on `web-console`:
- A Workspace Secrets management screen bound to the active tenant+workspace.
- A new route + nav entry, RBAC-gated and workspace-context-bound.
- Write-only value handling end-to-end (the UI-side invariant).
- A console secrets data client that calls **only** the advertised `function_workspace_secret` routes.
- Backend-disabled (`501`), empty, loading, validation, and authorization-denied states.

### 1b. `secrets` — **MODIFIED** requirement (Q1: close the contract↔runtime drift)
We choose to **implement the advertised contract** in the kind control-plane runtime (see Q1). That changes
the runtime's observable behavior of the workspace-secrets API, so the existing `secrets` capability
requirement **"Workspace secrets are stored in and consumed from \<OpenBao\>"** is **MODIFIED** to add:
- the **`PUT …/secrets/{name}` replace** operation (idempotent upsert), and
- the **richer metadata** the contract advertises on GET-list / GET-meta / write responses
  (`secretName`, `tenantId`, `workspaceId`, `resolvedRefCount`, `timestamps{createdAt,updatedAt}`,
  optional `description`), while **preserving** the write-only value invariant (no response ever carries a value).

> Spec-author note on the `secrets` spec body: the live `openspec/specs/secrets/spec.md` still reads
> "HashiCorp Vault". The backend was already swapped to OpenBao (`replace-vault-with-openbao`/#720).
> The MODIFIED requirement header MUST match the **current archived requirement name** verbatim so the
> delta applies; quote the existing title from `openspec/specs/secrets/spec.md` exactly (it currently says
> "stored in and consumed from Vault"). Do **not** silently rename Vault→OpenBao as part of *this* change —
> that wording belongs to #720; if #720's archive sync left the body stale, flag it as a separate cleanup,
> don't fold a rename into the console-secrets change (keeps the delta minimally scoped).

### 1c. `functions` — **no change** (decided NOT to touch)
The `function_workspace_secret` routes live under the `functions` family in the catalog/OpenAPI, but the
`functions` *capability spec* is about deploy/invoke/activations/tenant-scoping, and there is a separate
`secrets` capability that already owns workspace-secret storage. Keep the secrets behavior in `secrets`,
not `functions`, to avoid a split-brain ownership. (If the spec-author finds the existing `secrets`
requirement is the only home for the deploy-time `resolveEnv` behavior, that confirms `secrets` is the
right MODIFIED target.)

### 1d. REMOVED — none
Nothing is removed. The mock rotation pages are **kept** (backward-compat, §7) and explicitly out of
scope; we do not delete the superadmin rotation plane.

**Summary partition:** `web-console` **ADDED** (the screen/client/route/nav/RBAC/states) · `secrets`
**MODIFIED** (add PUT + richer metadata in the kind runtime, write-only preserved) · `functions` untouched
· nothing REMOVED.

---

## 2. Open-question resolutions (Q1–Q6)

### Q1 — Contract↔runtime drift. **DECISION: implement the advertised contract in the kind CP runtime.**
**Implement**, do not trim the UI. Rationale:
- The catalog (`public-route-catalog.json`) **is the enforced gateway allow-list and the published public
  surface**; the OpenAPI already ships `updateFunctionWorkspaceSecret` (PUT) and the richer
  `FunctionWorkspaceSecret` schema. A console built to the published contract is the correct integration
  target; trimming the UI to the runtime's `{name,version}` shape would bake a known runtime gap into a
  second consumer and leave the advertised PUT a 404 (the `NO_ROUTE`/`No action mapped` class of bug this
  repo repeatedly fixes — cf. data-export #683, flow-schedule #680).
- The change is **small and low-risk**: POST is already an OpenBao KV v2 **upsert** (`writeSecret` overwrites,
  bumping version), so PUT-replace is the same store call with replace semantics; metadata is derivable
  without a new datastore (see below). This is **kind-runtime drift**, the exact pattern repeatedly resolved
  in this repo (e.g. #683, #676, #673) — implement the advertised surface in the kind CP runtime so the
  contract and runtime agree.

This makes the `secrets` capability **MODIFIED** (§1b). Concretely the runtime MUST:
1. **Add `PUT /v1/functions/workspaces/{workspaceId}/secrets/{secretName}`** → `secretReplace` handler
   (new entry in `routes.mjs`, new handler in `fn-handlers.mjs`), gated by `ownedWorkspace` exactly like
   the others, `auth:'authenticated'`. Replace semantics = OpenBao KV v2 write (a new version), returning the
   metadata shape. Reuse the value/name validation from `secretSet`. (Reuse `vaultStore.set`; PUT and POST
   share the upsert — the contract distinction is "create vs replace", both land as a KV write/new version.)
2. **Return the advertised metadata** on POST/PUT/GET-list/GET-meta:
   - `secretName` (rename/alias `name`→`secretName`; keep `name` too if needed for back-compat — but the
     console reads `secretName`).
   - `tenantId` = `ws.tenant_id`, `workspaceId` = `ws.id` (both already in scope server-side — never from body).
   - `timestamps {createdAt, updatedAt}` — OpenBao KV v2 metadata already carries `created_time` and
     per-version times; `getMeta` can read `{mount}/metadata/{path}` (not just `data`) to surface them
     (`readSecret` currently reads `data`; add a metadata read or extend the client). `updatedAt` already
     exists synthetically in `set` L115.
   - `resolvedRefCount` — count of deployed functions in this workspace whose declared `secretRefs` reference
     this secret name. The function registry rows are in Postgres (`fn_actions`, with `b.execution.secrets`
     refs persisted); compute by scanning the workspace's actions' secret refs for `secretName`. If a precise
     count is not cheaply available, surface `0` and treat the field as **best-effort, non-authoritative**
     (the spec MUST state it is advisory, used only for the pre-delete warning, never a hard gate).
   - `description` (optional) — accept on write (`FunctionWorkspaceSecretWriteRequest.description`), store it
     alongside the value in the KV item's `data` map under a reserved key (e.g. `data.value` + `data._desc`)
     **OR** in the KV custom-metadata; return it on GET. It is **non-secret** metadata. (Storing in the same
     KV entry avoids a new table. The write-only invariant still holds: only `value` is withheld; `_desc` is
     returned, `value` never is.)
3. **Preserve write-only**: no new code path returns `data.value`. `secretGet`/`secretList` keep using the
   metadata path. The PUT/POST responses carry metadata only.

**Open item flagged to analyst (non-blocking):** `resolvedRefCount` precision — is an approximate/zero
acceptable for v1, or must it be exact? (Recommend: advisory, exact-if-cheap, documented as best-effort.)

### Q2 — Stage scoping. **DECISION: stage IS the active workspace's `environment`; no extra dimension.**
A workspace-secret is per-workspace, and a workspace **is** the stage/environment unit
(`console-context.tsx` `Workspace.environment` L92; `ConsoleWorkspaceOption.environment` L165). The UI models
stage purely as the selected workspace's `environment` label; there is **no separate stage selector** and the
path has **no extra stage segment** (the path is `…/{workspaceId}/secrets/…`). The screen MUST show the active
workspace's `environment` so the operator knows which stage they are editing (a "dev/staging/prod" badge), but
must NOT offer a cross-environment view. **Confirmed; no change to the data model.**

### Q3 — RBAC gate (read vs mutate) + the per-workspace-role signal gap. **DECISION below.**
**Authoritative gate is server-side** (`ownedWorkspace` + catalog `audiences`). The console gate is
**defense-in-depth UX only and MUST fail safe**.

Exact intended authority (from catalog `audiences` = `[workspace_owner, workspace_admin, workspace_developer,
platform_team]` on **all five** routes — note: read and mutate currently share the same audience set, there is
**no separate read-only audience** in the catalog):
- **List / metadata-view (GET):** any operator whose verified tenant owns the workspace. Server enforces via
  `ownedWorkspace`.
- **Create / replace / delete (POST/PUT/DELETE):** same audience server-side today. There is **no built-in
  read-only/viewer audience** for workspace secrets in the catalog, so the spec MUST NOT promise a
  read-only-cannot-mutate guarantee the backend does not enforce. (See gap + recommendation below.)
- **Cross-tenant (superadmin / platform_team):** allowed by `callerTenantId(...)===null` (superadmin/internal
  bypass the tenant predicate). The console does **not** offer a cross-tenant secrets view; that path is
  CLI/API only and out of scope for this UI.

**The signal gap (real):** the console session principal exposes only `platformRoles`, `tenantIds`,
`workspaceIds` — **no per-workspace role** (`console-auth.ts` L52–61). So the console **cannot reliably
distinguish a workspace viewer from a workspace developer client-side.** Resolution:
- **Primary authority: the server `403`/`404`.** The UI MUST always defer to the server: attempt the mutation,
  and render the server's `403`/`404` as an authorization error (never assume success). **Never client-trust.**
- **Nav/route gate (coarse):** gate the screen on a signal the principal already carries — i.e. the operator is
  a member of the active workspace (`workspaceIds` includes the active workspace id) **or** a platform role
  (`platformRoles` ∩ {`superadmin`,`platform_admin`,`platform_operator`}) or a tenant role
  (`tenant_owner`/`tenant_admin`, already used as `isTenantOperator` in `console-context.tsx` L236–239).
  This mirrors the existing `RequireSuperadminRoute` pattern (`router.tsx` L91–95) but is **tenant/workspace
  membership-based, not superadmin-only**. Non-members get redirected; non-mutators are not hidden from the
  screen but the server enforces mutation authority.
- **Mutation-button gating (best-effort):** the safe-default is to **show** create/update/delete to any
  workspace member and let the server reject (since the client cannot know the workspace role). The spec
  SHALL state that the UI **does not weaken** the backend, and that the absence of a client-visible
  per-workspace role means the **server is the sole authority** for mutate permission.
- **RECOMMENDED follow-up (flag to analyst, OUT of this change unless analyst pulls it in):** expose a
  per-workspace role on the console session principal (extend `ConsoleSessionPrincipal` +
  `GET /v1/console/session`) so the UI can pre-disable mutations a viewer cannot perform. This is a
  **separate `web-console`/`iam` change** (touches the session whoami contract); doing it here would scope-creep
  the auth contract. For *this* change, the UI relies on the server `403` and a coarse membership nav-gate.

**Net Q3 decision:** nav/route gate = active-workspace membership OR tenant-admin OR platform role (fail-safe
redirect otherwise); mutate authority = **server-enforced** (`ownedWorkspace` + audiences), surfaced as a clean
auth error; do not claim a client-side viewer-vs-developer distinction the session can't support; recommend a
follow-up to expose per-workspace role.

### Q4 — Per-workspace secret quota. **DECISION: none exists; treat as a NOTED GAP, not in scope to add.**
Confirmed no count/size quota anywhere (grep across runtime+services found only rotation grace-period bounds).
The only enforced write-path limits are: value `maxLength 65535` (runtime `secretSet` requires non-empty;
OpenAPI `secretValue` 1..65535), gateway `maxRequestBodyBytes 1048576` (→ `413`), gateway
`rateLimitClass data-write` + `qosBurst 30` (→ `429`), and `planCapabilityAnyOf:['data.openwhisk.actions']`
(plan-gate → could yield 403). Decision:
- **In scope:** the UI MUST render `413` (value too large), `429` (rate-limited), and a plan-gate `403`
  distinctly, even though no *count* quota exists, because the gateway can emit `413`/`429`. The UI validates
  value length client-side (`maxLength 65535`) before submit.
- **Out of scope (noted gap):** adding a per-workspace secret **count** quota is a separate backend/quotas
  concern (would touch `quotas-plans`/`tenant-rbac` plan flags), not this console change. The spec SHALL note
  "no per-workspace secret count quota is enforced today" as a known gap and SHALL NOT assert a count-quota
  state. (Flag to analyst: do we want a count quota? If yes → separate change.)

### Q5 — Naming + delete safety. **DECISION: surface env-var name + `resolvedRefCount` + pre-delete warning.**
- The screen SHALL show, per secret, the **derived env-var name** (`secretEnvVarName(name)` = UPPER_SNAKE,
  `vault-secrets.mjs` L101) so operators see how the secret is injected.
- Before delete, the UI SHALL show a confirmation that includes **`resolvedRefCount`** ("this secret is
  referenced by N function(s); deleting it will remove the env var on the next deploy of those functions").
  This is critical because function deploy **silently skips** missing refs (`resolveEnv` L149 only pushes when
  `value != null`; `fnDeploy` does not fail on a missing secret) — so a delete can **silently break** a
  function's env at next deploy. The warning is the user-facing mitigation.
- `resolvedRefCount` comes from the Q1 metadata work (best-effort). If the backend can only return `0`, the
  warning copy SHALL be generic ("deleting may break functions that reference it") rather than claiming a count.

### Q6 — Idempotency-Key generation. **DECISION: solved by reuse; no extra client work.**
The shared `http.ts::requestJson` (L48–50) **already** sets `Idempotency-Key: idem_<uuid>` for any non-GET
request (and `X-API-Version`, `X-Correlation-Id` always). The new `secretsApi` MUST be built on
`requestConsoleSessionJson` (which delegates to `requestJson`), so create/replace/delete get a fresh
`Idempotency-Key` per call **for free**. The spec SHALL require the console secrets client to use the session
client (not a bare `fetch` like the legacy `secretRotationActions.ts`), so headers + Bearer + 401-refresh are
inherited. No per-create UUID plumbing is needed in the new client.

---

## 3. Impact across layers

### Backend (kind control-plane) — MODIFIED (`secrets` capability)
- `deploy/kind/control-plane/routes.mjs`: **add** one route
  `PUT /v1/functions/workspaces/{workspaceId}/secrets/{secretName}` → `localHandler:'secretReplace'`,
  `auth:'authenticated'` (alongside L257–260).
- `deploy/kind/control-plane/fn-handlers.mjs`: **add** `secretReplace` (mirror `secretSet`, replace semantics,
  `ownedWorkspace` gate, validation, return metadata). **Modify** `secretSet`/`secretList`/`secretGet` (and the
  new `secretReplace`) to return the advertised metadata shape (`secretName`, `tenantId`, `workspaceId`,
  `resolvedRefCount`, `timestamps`, optional `description`).
- `deploy/kind/control-plane/vault-secrets.mjs`: **extend** the store to (a) read KV **metadata** times for
  `timestamps`, (b) persist + return `description` (reserved non-secret key in the KV `data` map or KV
  custom-metadata), (c) keep `value` strictly write-only. **Modify** `set`/`getMeta`/`list` to carry the new
  fields. Add a `replace` path if PUT semantics differ from POST (otherwise reuse `set`).
- `resolvedRefCount`: read the workspace's function registry (`fn_actions` secret refs) via the existing
  Postgres store to count references (best-effort).
- **Dockerfile note (repo gotcha):** any **new** server `.mjs` module must be added to the kind-CP Dockerfile
  COPY list, or the control-plane crashes on boot. Here we are editing **existing** modules
  (`fn-handlers.mjs`, `routes.mjs`, `vault-secrets.mjs`) — no new file — so **no Dockerfile change** is needed.
  The spec-author/builder MUST keep it that way (extend existing modules, don't add a new file) unless they
  also update the Dockerfile.
- **OpenAPI/catalog reconciliation:** the contract **already** advertises PUT + the richer schema, so
  implementing it makes the runtime **match** the published OpenAPI/catalog — **no new public route is invented,
  no catalog edit is required.** (Verify with `npm run generate:public-api` produces no diff; if it does, the
  runtime, not the contract, is what changes.) This is contract-vs-runtime convergence, not a contract change.

### Frontend (web console) — ADDED (`web-console` capability)
- **New page** `apps/web-console/src/pages/ConsoleWorkspaceSecretsPage.tsx` (distinct from the mock
  `ConsoleSecretsPage.tsx`): table of `{secretName, env-var name, version, resolvedRefCount, timestamps,
  description?}`; create form (name + masked value + optional description); replace (masked value, never
  pre-filled); delete with the Q5 confirmation. Bound to `console-context` `activeWorkspaceId` /
  `activeWorkspace.environment`; requires a selected workspace (empty state otherwise).
- **New client** `apps/web-console/src/services/secretsApi.ts` mirroring `functionsApi.ts`: `listSecrets`,
  `createSecret`, `updateSecret` (PUT), `deleteSecret`, `getSecretMeta` — all on `requestConsoleSessionJson`,
  paths exactly `/v1/functions/workspaces/{workspaceId}/secrets[...]`. **No value-returning method.** Types
  mirror the OpenAPI `FunctionWorkspaceSecret*` schemas (no `value`/`secretValue` field on any read type;
  `secretValue` only on the write-request type, never stored in component state after submit).
- **New route** in `router.tsx`: e.g. `path: 'workspace-secrets'` → `<RequireWorkspaceSecretsRoute>` guard
  (membership/tenant-admin/platform, §Q3) wrapping the page. **Do not** reuse the existing `/console/secrets`
  (rotation mock) route. Leave the mock route as-is (§7).
- **New guard** `RequireWorkspaceSecretsRoute` (sibling to `RequireSuperadminRoute`, `router.tsx` L91–95):
  redirect to `/console/my-plan` if the operator is neither a member of the active workspace nor a
  tenant-admin/platform role.
- **New nav entry** in `ConsoleShellLayout.tsx` `navItems` ("Workspace Secrets" → `/console/workspace-secrets`),
  conditionally rendered by the same coarse gate. (navItems has no guard field today; add a minimal
  `requiresWorkspaceContext`/role predicate or filter the array against the session — small shell change.)
- **States:** loading, empty ("no secrets in <workspace> (<environment>)"), validation (name regex
  `^[a-z][a-z0-9_-]{0,62}$`, non-empty value, `maxLength 65535`), and distinct error rendering for
  `400`/`404`(secret)/`404`(workspace→generic "not available")/`409`(create dup)/`413`/`429`/`403`(authz)/
  `501`(backend disabled)/`502`(backend failure).

### Wire / contract (backend↔frontend)
- **Routes (reuse, no invention):** the five advertised `function_workspace_secret` routes. The console calls
  all of them; the runtime now serves all five (POST/GET-list/GET-meta/**PUT**/DELETE).
- **Shapes:** console read types == OpenAPI `FunctionWorkspaceSecret` / `FunctionWorkspaceSecretCollection`;
  write == `FunctionWorkspaceSecretWriteRequest`. **The runtime convergence in §Backend is what makes the
  console's contract-faithful types correct** — this is the central backend↔frontend contract alignment of
  this change. The console MUST tolerate the runtime alias `name`↔`secretName` only during the transition;
  target is `secretName` everywhere post-convergence.
- **Headers:** `Idempotency-Key` (auto, non-GET), `X-API-Version`, `X-Correlation-Id` (auto), `Authorization`
  (session client). No SDK/codegen change beyond the new TS client.

### Datastores
- **OpenBao KV v2** only. **No new table.** `description` rides in the existing KV entry (reserved non-secret
  key) or KV custom-metadata; `timestamps` come from KV metadata; `resolvedRefCount` is **computed**, not
  stored, from the existing `fn_actions` registry. Deletes remove **all versions** (`deleteSecret` → KV
  `metadata` DELETE, `vault-secrets.mjs` L82–86) — unchanged.

### Identity / RBAC
- Keycloak session via the console; route `audiences` enforced at the gateway; `ownedWorkspace` enforced in the
  runtime. The console adds a **coarse** membership/role nav+route gate (§Q3) and otherwise defers to the
  server. No new Keycloak roles, no new audiences (reuse the catalog's existing audience set).

---

## 4. Mandatory cross-cutting requirements (normative — encode as SHALL)

1. **Tenant + workspace isolation (top priority).** Every secret op SHALL be scoped to the **active workspace
   via the URL path**; the tenant and workspace SHALL be derived **server-side** from the verified principal
   (`ownedWorkspace`/`callerTenantId`), **never** from client input/body. Cross-tenant or cross-workspace
   access SHALL be denied with **`404`** (no existence leak), and the console SHALL render it as a generic
   "not available" (never reveal another scope's secret names). The UI SHALL **never** offer a
   multi-workspace/multi-tenant secrets view; it SHALL require a selected workspace before any op.
2. **Secret-value write-only (security-critical, defense-in-depth).** Values SHALL be **write-only end to end**:
   masked input, **never pre-filled** from any GET, **cleared from component state after submit**; **no read
   response field SHALL carry a value**; the console SHALL **never** call a value-returning API (none is
   exposed — `getValue`/`resolveEnv` are server-only at deploy); **no secret value SHALL appear** in client
   logs/telemetry/DOM/URL/query string. The UI SHALL **rely on but not weaken** the backend write-only
   invariant.
3. **Data governance.** Only secret **names/metadata** (never values) SHALL be handled client-side. `description`
   is **non-secret** metadata. **Deletion SHALL remove all versions.** The pre-delete reference-safety warning
   (Q5) SHALL be shown.
4. **Quotas / limits.** The UI SHALL validate `secretName` (`^[a-z][a-z0-9_-]{0,62}$`) and value
   (non-empty, `maxLength 65535`) client-side, and SHALL render `413` and `429` (and a plan-gate `403`)
   distinctly. (No per-workspace **count** quota exists — the spec SHALL NOT assert one; §Q4.)
5. **Observability / audit.** Every mutating action (create/replace/delete) SHALL be audited **server-side**
   with value **redacted** (OpenBao file audit → `secret-audit-handler` sanitizer; `services/secret-audit-handler/src/sanitizer.mjs`). The console SHALL surface success/failure (with `X-Correlation-Id` for support) but SHALL log **no secret value** in any client telemetry.
6. **AuthN/AuthZ.** Authority is **server-side** (`ownedWorkspace` + catalog `audiences`). The console SHALL
   fail safe: gate nav/route on workspace membership/role (coarse), and SHALL surface server `403`/`404` as a
   clean authorization error; it SHALL **never client-trust** a mutate decision.
7. **Error handling.** The UI SHALL map `400`/`404`(secret)/`404`(workspace)/`409`/`413`/`429`/`403`/`501`/
   `502` to distinct, non-leaky states; `501 SECRETS_BACKEND_DISABLED` SHALL render an explicit "secrets
   backend unavailable" state (not an error toast loop), since the backend is **off by default**.

---

## 5. Risks & trade-offs

- **R1 — Backend change widens blast radius.** Q1 makes this a frontend **+ backend** change (touching the
  live secrets API), not console-only. Mitigation: changes are confined to three existing modules, reuse the
  isolation gate, add no new public route, and must be **live-verified** on kind with OpenBao enabled
  (`values-kind-vault.yaml`) — fetch-seam unit tests **cannot** validate real OpenBao KV-metadata field names
  (a repeated lesson: #668/#676/#683 fake-fetch tests passed invalid field shapes). The PUT + metadata read
  MUST be checked against a real OpenBao instance.
- **R2 — `resolvedRefCount` accuracy.** Computing references from `fn_actions` may be imprecise (refs can be by
  name or `{name,env}`; some functions may be undeployed). Mitigation: spec it as **advisory/best-effort**,
  used only for the warning; never a hard delete gate.
- **R3 — Write-only regression.** Adding `description` to the KV entry risks accidentally returning the value if
  the read path is widened. Mitigation: the read path MUST whitelist returned keys (return `_desc`, **never**
  `value`); add a black-box assertion that no read response carries the value.
- **R4 — RBAC over-promise.** The session lacks a per-workspace role, so a strict "viewer cannot mutate"
  client guarantee is impossible today. Mitigation: spec the server as sole mutate authority; don't assert a
  client-side viewer block; recommend a follow-up to expose the role.
- **R5 — Two "Secrets" screens confuse users.** The mock rotation page stays. Mitigation: relabel nav clearly
  ("Workspace Secrets" vs the rotation page's "Secrets"/"Secret Rotation"); the rotation page is superadmin-only
  and a separate concern.
- **R6 — Backend off by default → empty UX.** Most installs have OpenBao disabled (`501`). Mitigation: the
  `501` state is a first-class, explanatory empty state, not a failure.

---

## 6. Alternative considered

**Alternative A — Repurpose the existing `ConsoleSecretsPage`/`ConsoleSecretRotationPage` (mock rotation
pages) into the workspace-secrets screen** (reuse the route `/console/secrets`, the table, the dialogs).
- *Why considered:* less net-new code; an existing route + table + nav slot already exist; "secrets" naming is
  already there.
- *Why rejected:* those pages target a **fundamentally different plane** — the superadmin **platform/tenant
  rotation** lifecycle (`/v1/platform/secrets/{domain}/{name}/...` via a **bare `fetch` with no auth header**,
  hard-coded mock rows, version/revoke/grace-period concepts that **do not exist** for workspace function
  secrets, which are simple write-only KV with no rotation/grace/revoke UI). Reusing them would conflate two
  authorization planes (superadmin-global rotation vs workspace-member CRUD), force the rotation data model
  onto a CRUD feature, and drag in the unauthenticated `secretRotationActions` client. The analyst already
  flagged this as the WRONG plane. **Chosen instead:** a **distinct new page + route + client**
  (`ConsoleWorkspaceSecretsPage` / `secretsApi`), with the mock rotation pages left intact (relabelled),
  consistent with how the console already separates concerns (e.g. `functionsApi`, `ConsoleFunctionsDataPage`).

**Alternative B (for Q1) — Trim the UI to the runtime's `{name,version}` shape** (no backend change).
- *Why rejected:* bakes the runtime gap into a second consumer, leaves the advertised PUT a 404, and ships a
  console that contradicts the published OpenAPI — the opposite of the contract-vs-runtime convergence this
  repo standardizes on. Chosen: implement the contract (Q1).

---

## 7. Backward compatibility

- **No breaking change to the public contract.** Implementing PUT + richer metadata makes the runtime **match**
  the already-published catalog/OpenAPI — existing API/CLI consumers that read `{name,version}` still get those
  fields (we **add** `secretName`/metadata, keep `name` as an alias if any consumer relies on it; the
  spec-author SHOULD keep `name` present to avoid breaking the current runtime's existing callers). No field is
  removed from existing responses; PUT is additive.
- **Existing mock rotation pages** (`ConsoleSecretsPage`/`ConsoleSecretRotationPage`, `/console/secrets`,
  `secretRotationActions.ts`) are **untouched and kept** — no behavioral change, just a nav relabel to
  disambiguate from the new screen.
- **Backend off by default unchanged.** When OpenBao is unconfigured, every secret route still returns `501`
  and the default install renders no secret-store workload (per the `secrets`/`deployment` specs). The console
  MUST degrade gracefully to the `501` state.
- **#720 identifiers intact.** The Vault→OpenBao swap left `secretBackend:"vault"`/`vault_version`/`X-Vault-Token`
  identifiers in place; this change does **not** rename them. The `secrets` MODIFIED requirement title MUST be
  quoted verbatim from the live archived spec (which still says "Vault") so the delta applies; any Vault→OpenBao
  body-wording cleanup is **#720's** concern, not this change (flag separately).
- **Idempotency/headers** are inherited from the existing console HTTP layer — no version bump, no new header
  contract.

---

## 8. Open questions to send back to the analyst (non-blocking)

1. **`resolvedRefCount` precision (Q1/Q5):** is advisory/best-effort (or `0` when uncomputable) acceptable for
   v1, or must it be exact? (Recommend: advisory.)
2. **Per-workspace secret count quota (Q4):** do we want one? If yes, it is a **separate** quotas/plans change,
   not this console feature.
3. **Per-workspace role on the session principal (Q3):** approve a **follow-up** `web-console`/`iam` change to
   expose a per-workspace role on `GET /v1/console/session` so the UI can pre-disable mutations for viewers?
   (Out of scope here; this change relies on the server `403` + a coarse membership gate.)
4. **`description` storage location:** confirm acceptability of storing the optional non-secret `description` in
   the same OpenBao KV entry (reserved key) vs KV custom-metadata — both avoid a new table; pick one in the
   spec.

---

## 9. Hand-off summary for the spec-author

- **ADDED → `web-console`:** Workspace Secrets screen + route + nav + RBAC guard + `secretsApi` client +
  write-only/empty/validation/error/`501` states; bound to active tenant+workspace; distinct from the rotation
  mock.
- **MODIFIED → `secrets`:** kind CP runtime adds `PUT …/secrets/{name}` (replace) and returns the advertised
  `FunctionWorkspaceSecret` metadata (`secretName`, `tenantId`, `workspaceId`, `resolvedRefCount`, `timestamps`,
  optional `description`), write-only value preserved. Quote the existing requirement title verbatim
  (it currently reads "Vault").
- **`functions`:** untouched. **REMOVED:** none.
- **Q1** implement-the-contract · **Q2** stage = workspace.environment (no new dim) · **Q3** server-authoritative
  RBAC + coarse membership nav gate, no client viewer/dev distinction (session lacks the role; follow-up to add
  it) · **Q4** no count quota (noted gap; render `413`/`429`/plan-`403`) · **Q5** show env-var name +
  `resolvedRefCount` + pre-delete warning · **Q6** Idempotency-Key/headers free via `requestConsoleSessionJson`.
- **Reuse, don't invent:** the five `function_workspace_secret` routes; `requestConsoleSessionJson`;
  `ownedWorkspace`; the `RequireSuperadminRoute` guard pattern; the `functionsApi.ts` client shape. **No new
  public route, no new table, no new server `.mjs` file (extend existing modules; keep the kind-CP Dockerfile
  COPY list unchanged).**
- **Cross-cutting SHALLs:** isolation (path-scoped, server-derived tenant/ws, `404` no-leak, no multi-scope
  view); write-only value (masked, never pre-filled, cleared, no value in any response/DOM/URL/log); audit
  server-side value-redacted; validation + `413`/`429`/`403`/`409`/`501`/`502` states; server-authoritative
  authz with fail-safe UI.
