## ADDED Requirements

### Requirement: Web console provides a Workspace Secrets management screen

The web console SHALL provide a **Workspace Secrets** screen that lets an operator of the active
workspace manage that workspace's function secrets over the published
`function_workspace_secret` API: **list** (names and metadata only), **create**, **update/replace**,
**delete** (with a confirmation dialog), and view a **metadata-only detail**. The screen SHALL be bound to
the active tenant and workspace from the console context (`activeTenantId`/`activeWorkspaceId`) and SHALL
display the active workspace's `environment` as the stage being edited (e.g. a dev/staging/prod badge); it
SHALL NOT offer any cross-workspace, cross-stage, or cross-tenant secrets view. When no workspace is
selected, the screen SHALL render an explicit "select a workspace" empty state and SHALL NOT issue any
secret request.

Every operation SHALL be addressed to the active workspace **via the URL path**
(`/v1/functions/workspaces/{workspaceId}/secrets[/{secretName}]`); the screen SHALL NOT place a `tenantId`
or `workspaceId` in any request body to select scope (scope is server-derived from the verified
principal). The screen SHALL refresh the list after every successful mutation.

For each secret the list SHALL show only the non-secret metadata of the published `FunctionWorkspaceSecret`
schema — the secret `secretName` (with the legacy `name` alias tolerated during convergence), its derived
UPPER_SNAKE environment-variable name (so the operator sees how it is injected), `resolvedRefCount`,
`timestamps`, and an optional `description` — and SHALL NEVER show, fetch, or render a secret value, nor a
field absent from that schema (no KV `version` is shown, as no response body carries one).

#### Scenario: Create a workspace secret (happy path)

- **WHEN** a workspace owner of tenant T has workspace W selected and submits a new secret
  `db-password` with a value via the create form
- **THEN** the console issues `POST /v1/functions/workspaces/{W}/secrets` (with an auto-generated
  `Idempotency-Key`), receives `201` with the secret's metadata (no value field), clears the value input
  from component state, and refreshes the list so the new secret appears with its metadata only

#### Scenario: List shows metadata only, never a value

- **WHEN** the Workspace Secrets screen loads for a workspace that has secrets
- **THEN** the console issues `GET /v1/functions/workspaces/{W}/secrets`, renders the secret names,
  env-var names, `resolvedRefCount`, timestamps, and any descriptions, and **no secret value appears
  anywhere in the response payload or the rendered DOM**

#### Scenario: Update (replace) then delete a secret

- **WHEN** an authorized operator replaces a secret's value (submitting a new masked value) and later
  deletes the secret after confirming the deletion dialog
- **THEN** the console issues `PUT /v1/functions/workspaces/{W}/secrets/{name}` for the replace
  (receiving the secret metadata, no value) and `DELETE /v1/functions/workspaces/{W}/secrets/{name}` for
  the delete (receiving a success status — the kind runtime emits `200` with `{name, deleted:true}` whereas
  the advertised contract is `204`; the console treats either as success), the list reflects the change,
  and at no point is a stored value displayed

#### Scenario: Stage equals the active workspace environment

- **WHEN** the operator switches the active workspace to one whose `environment` is `production`
- **THEN** the screen shows a production stage indicator, scopes every secret op to that workspace's path,
  and offers no separate stage selector and no path segment beyond `{workspaceId}` (the workspace *is* the
  stage unit)

### Requirement: Workspace Secrets screen handles secret values write-only end to end

The Workspace Secrets screen SHALL treat secret values as **write-only end to end**. The value input
SHALL be masked, SHALL **never** be pre-populated from any read/list/detail response, and SHALL be
**cleared from component state immediately after a create or replace is submitted**. The console SHALL
**never** call a value-returning API (none is exposed — the server resolves a value only at function
deploy, server-side), and SHALL rely on but never weaken the backend write-only invariant. No secret value
SHALL appear in any response field the console reads, in the rendered DOM, in the URL or query string, or
in any client log or telemetry.

#### Scenario: A stored secret value never appears in any response or the DOM

- **WHEN** the console performs any list or metadata-detail read for a workspace's secrets
- **THEN** no field of any response carries a secret value, the value is never written into the DOM, the
  URL/query string, the browser console, or any client telemetry, and the screen never offers a
  "reveal"/"show value" affordance (because no value-returning endpoint exists)

#### Scenario: The value input is masked, never pre-filled, and cleared after submit

- **WHEN** the operator opens the create or replace form for a secret
- **THEN** the value field is masked and empty (never pre-filled from a prior read), and after a successful
  submit the value is removed from component state so a subsequent re-render or navigation cannot expose it

### Requirement: Console secrets data client calls only the advertised secret routes via the session HTTP layer

The console SHALL include a `secretsApi` data client (alongside `functionsApi`) that calls **only** the
five advertised `function_workspace_secret` routes — `listSecrets` (`GET …/secrets`), `getSecretMeta`
(`GET …/secrets/{name}`), `createSecret` (`POST …/secrets`), `updateSecret` (`PUT …/secrets/{name}`), and
`deleteSecret` (`DELETE …/secrets/{name}`) — and SHALL expose **no method that returns a secret value**.
The client SHALL be built on the existing authenticated console HTTP layer (`requestConsoleSessionJson` over
`http.ts`) so that it **inherits**, without per-call plumbing, the `Authorization` bearer, the
401-refresh-retry, `X-API-Version`, `X-Correlation-Id`, and (for any non-GET request) a fresh
`Idempotency-Key`. The client SHALL NOT use a bare unauthenticated `fetch` (unlike the legacy
`secretRotationActions` client). The client's read types SHALL mirror the OpenAPI `FunctionWorkspaceSecret`
/ `FunctionWorkspaceSecretCollection` schemas and SHALL contain **no** value field; only the write-request
type carries `secretValue`, which SHALL never be retained in component state after submit. During the
runtime convergence the client MAY tolerate the legacy `name` alias alongside `secretName`, but SHALL read
`secretName` as the canonical field.

#### Scenario: Mutating calls carry the inherited idempotency and correlation headers

- **WHEN** the `secretsApi` client issues a create, replace, or delete
- **THEN** the request automatically carries a unique `Idempotency-Key`, `X-API-Version`,
  `X-Correlation-Id`, and the session `Authorization` bearer (inherited from the shared console HTTP
  layer), with no per-call header construction in the secrets client

#### Scenario: The client exposes no value-returning operation

- **WHEN** the client surface is inspected
- **THEN** there is no method that returns a secret value, and `getSecretMeta`/`listSecrets` return only
  the metadata schema (no value field), so a value can never be retrieved through the console

### Requirement: Workspace Secrets screen is reached by a gated nav entry and a fail-safe route guard

The console SHALL add a **Workspace Secrets** navigation entry and a dedicated route, distinct from the
existing superadmin secret-rotation mock pages and route. The route SHALL be wrapped in a **fail-safe
guard** (mirroring the existing `RequireSuperadminRoute` pattern but workspace-membership based): an
operator who is **neither a member of the active workspace nor a tenant-admin/platform-role** SHALL be
redirected away (e.g. to `/console/my-plan`) and SHALL NOT render the screen. The nav entry SHALL be shown
only when that same coarse gate is satisfied. The pre-existing `/console/secrets` rotation pages and their
client SHALL be left untouched (only relabeled in the nav to disambiguate them from the new screen).

Because the console session principal carries no per-workspace role, the route/nav gate SHALL be **coarse**
(workspace membership / tenant-admin / platform role) and SHALL NOT claim a client-side viewer-vs-developer
distinction; per-secret mutate authority remains **server-enforced** (see the authorization requirement).

#### Scenario: A non-member operator cannot reach the screen

- **WHEN** an operator who is not a member of the active workspace and holds no tenant-admin or platform
  role navigates to the Workspace Secrets route
- **THEN** the guard redirects them away (e.g. to `/console/my-plan`), the Workspace Secrets screen is not
  rendered, and the nav entry is not shown to them

#### Scenario: Platform-domain rotation secrets are not manageable from this screen

- **WHEN** a tenant operator uses the Workspace Secrets screen
- **THEN** the screen exposes no path to create, rotate, or revoke platform/iam/gateway/tenant rotation
  secrets (a separate superadmin-only plane); it manages only `function_workspace_secret` resources for the
  active workspace, and the legacy rotation mock pages remain a separate, relabeled, superadmin-only
  surface

### Requirement: Workspace Secrets screen defers to the server for authorization and never client-trusts a mutation

Authorization for workspace secrets SHALL be **server-authoritative** (the runtime `ownedWorkspace` gate
plus the route audiences). The console SHALL **fail safe**: it MAY show create/update/delete affordances to
any workspace member (it cannot know the per-workspace role), but it SHALL **always defer to the server** —
it SHALL attempt the mutation and render a server `403` as a clean authorization error (never assuming
success), and it SHALL NOT use any client-side signal to grant a mutation the server would deny. A
cross-tenant or cross-workspace `404` SHALL be rendered as a generic "not available" state that never
reveals another scope's secret names or existence.

#### Scenario: Cross-tenant access is denied without leaking existence

- **WHEN** an operator of tenant B (using a console session for B) targets a workspace id owned by
  tenant A
- **THEN** the runtime returns `404 WORKSPACE_NOT_FOUND` (the `ownedWorkspace` gate, no existence leak) and
  the console renders a generic "not available" state — never tenant A's secret names, count, or any
  confirmation that the workspace exists

#### Scenario: A different workspace's secrets are never listed

- **WHEN** an operator of tenant A has workspace W1 selected
- **THEN** only W1's secrets are listed; W2's secrets (even within the same tenant A) do not appear, and
  viewing W2's secrets requires explicitly switching the active workspace to W2

#### Scenario: An unauthorized mutation is surfaced as a clean authorization error

- **WHEN** an operator whose server-side role does not permit mutation attempts to create, replace, or
  delete a secret
- **THEN** the console issues the request, the server returns `403`, and the console renders it as a clean
  authorization-denied error (it does not silently succeed, retry indefinitely, or claim the action
  worked), with the `X-Correlation-Id` available for support

### Requirement: Workspace Secrets screen validates input and renders distinct loading, empty, validation, quota, and backend-state errors

The Workspace Secrets screen SHALL validate input client-side and render **distinct, non-leaky** states for
each backend outcome. It SHALL validate the secret name against `^[a-z][a-z0-9_-]{0,62}$` and the value as
non-empty with `maxLength 65535` **before** submit, and SHALL map server responses to distinct states:
`400 VALIDATION_ERROR` (bad name/value), `404 SECRET_NOT_FOUND` (missing secret), `404 WORKSPACE_NOT_FOUND`
(generic "not available", per the authorization requirement), `409` (duplicate name on create — no silent
overwrite), `413` (value too large), `429` (rate-limited), a plan-gate `403`, `501 SECRETS_BACKEND_DISABLED`
(an explicit "secrets backend unavailable" state, not an error-toast loop, because the backend is **off by
default**), and `502` (backend failure). (`501 SECRETS_BACKEND_DISABLED` and `502` are **runtime-emitted**
states that the advertised `function_workspace_secret` response set does not enumerate; the console maps
them defensively because the kind runtime can return them — this is not a contract regression.) The screen
SHALL also render distinct **loading** and **empty** states (the empty state naming the active workspace
and its environment). No per-workspace secret **count** quota is enforced today, so the screen SHALL NOT
assert or surface a count-quota state.

Before deleting a secret, the screen SHALL show a confirmation that includes a **reference-safety warning**:
because function deploy silently skips a missing secret reference, deleting a referenced secret can silently
break a function's environment on its next deploy. When `resolvedRefCount` is available, the warning SHALL
state the count of referencing functions; otherwise it SHALL be generic ("deleting this secret may break
functions that reference it on their next deploy").

#### Scenario: Invalid name or empty value is blocked client-side

- **WHEN** the operator submits an invalid secret name (e.g. `DB_PASSWORD`, a leading digit, or longer than
  63 characters) or an empty value
- **THEN** the form blocks the submit with an inline validation message and issues no request; if a bad
  name/value somehow reaches the server it returns `400 VALIDATION_ERROR`, which the screen surfaces
  distinctly

#### Scenario: Duplicate secret name on create is reported, not silently overwritten

- **WHEN** the operator creates a secret whose name already exists in the workspace
- **THEN** the server returns `409` and the screen reports the conflict (directing the operator to use
  replace/update), without silently overwriting the existing value

#### Scenario: The secrets backend is disabled

- **WHEN** the OpenBao secrets backend is not configured for the installation
- **THEN** every secret op returns `501 SECRETS_BACKEND_DISABLED` and the screen renders an explicit
  "secrets backend unavailable" state (a first-class informational state, not a repeating error toast)

#### Scenario: Over-size value and rate-limit are rendered distinctly

- **WHEN** a value exceeds the platform body limit (`413`) or the operator exceeds the write rate limit
  (`429`)
- **THEN** the screen renders each as its own distinct, non-leaky message (value-too-large vs
  rate-limited), and the client also pre-validates the value length (`maxLength 65535`) to avoid the `413`
  where possible

#### Scenario: Delete confirmation warns about referencing functions

- **WHEN** the operator initiates deletion of a secret with `resolvedRefCount` greater than zero
- **THEN** the confirmation dialog warns that N function(s) reference the secret and that deleting it will
  remove the injected env var on their next deploy; with no reliable count it shows a generic
  reference-safety warning instead

### Requirement: Workspace Secrets console mutations are observable without leaking secret values

Every mutating action from the Workspace Secrets screen (create, replace, delete) SHALL be auditable
**server-side** with the secret **value redacted** (the OpenBao file-audit pipeline sanitized by
`services/secret-audit-handler/src/sanitizer.mjs`), capturing actor, tenant, workspace, operation, and
secret name. The console SHALL surface operation success/failure to the operator and SHALL make the
`X-Correlation-Id` available for support, but SHALL include **no secret value** in any client log,
telemetry, error report, or breadcrumb.

#### Scenario: A mutation produces a value-redacted audit event

- **WHEN** an operator successfully creates, replaces, or deletes a secret from the console
- **THEN** a server-side audit event records the actor, tenant, workspace, operation, and secret name with
  the value redacted, and the console reports the outcome to the operator without emitting the secret value
  to any client log or telemetry
