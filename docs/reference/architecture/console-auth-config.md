# Tenant realm auth-config — console screen

Every tenant is provisioned with its own Keycloak realm, and that realm's **login behavior**
(registration, email login, password reset, remember-me, email verification, and configured social
identity providers) has always been fully manageable server-side via
`GET`/`PUT /v1/tenants/{tenantId}/auth-config` (`deploy/kind/control-plane/b-handlers.mjs::getAuthConfig`
/ `setAuthConfig`, `authorizeAuthConfig`). Until this change, however, no console screen called it — a
tenant owner had no way to change their own realm's login settings without raw API access (#782).

This page documents the **Autenticación de la organización** console screen
(`/console/auth-config`, `apps/web-console/src/pages/ConsoleAuthConfigPage.tsx`) and the client it is
built on (`apps/web-console/src/services/authConfigApi.ts`).

The screen is distinct from the existing superadmin-only **Autenticación** screen (`/console/auth`,
`ConsoleAuthPage.tsx`), which is a realm/IAM **inventory** view (users/roles/scopes/clients) plus
external-application management and is gated to `superadmin` (owners are redirected away from it, per
#740). `/console/auth-config` is the **opposite**: a tenant owner/admin-reachable surface for that
tenant's **own** realm login settings — it is **not** superadmin-gated.

## Who can use it

Authorization is server-authoritative (`authorizeAuthConfig` calls the same `canManageTenant` gate as
other tenant-owner-scoped writes): the tenant's **owner**/**admin**, or a **superadmin**, may read and
write the config; any other verified principal receives `403 FORBIDDEN` with
`{ code: 'FORBIDDEN', message: 'requires superadmin or the tenant owner/admin of this project' }`. The
console route (`router.tsx`, path `auth-config`) and nav entry
(`layouts/ConsoleShellLayout.tsx`) are **plain** — not wrapped in `RequireSuperadminRoute` — because a
tenant owner must be able to reach the page; the page itself renders the server's `403` as a clean,
localized "blocked" state (never the raw backend message) rather than assuming success or granting the
mutation client-side.

## The 5 editable booleans

| Field | Console label | Meaning |
| --- | --- | --- |
| `registrationAllowed` | Permitir el registro de usuarios | Users can self-register from the login screen. |
| `loginWithEmailAllowed` | Permitir inicio de sesión con correo electrónico | Users may log in with their email address, not only their username. |
| `resetPasswordAllowed` | Permitir recuperación de contraseña | Users can request a password-reset link. |
| `rememberMe` | Permitir «recordar sesión» | Users can stay logged in across visits. |
| `verifyEmail` | Requerir verificación de correo electrónico | New users must verify their email before they can log in. |

`PUT /v1/tenants/{tenantId}/auth-config` is a **partial patch**: the body may include any subset of
these 5 keys (at least one boolean is required, else `400 VALIDATION_ERROR`), and only the supplied
keys are changed on the realm — the server always returns the **full**, persisted config (never a
partial echo). The screen mirrors this: it tracks a local draft against the last-loaded config, the
Save button is disabled while the draft is clean or a save is in flight, and it `PUT`s **only the
changed booleans**. On a successful save the draft is re-seeded from the response so the UI reflects
the *persisted* value, and a polite (`aria-live="polite"`) success notice is announced.

## Identity providers

`GET …/auth-config` also returns the realm's configured social identity providers
(`identityProviders: [{ alias, providerId, enabled, displayName }]`, from Keycloak's
`identity-provider/instances`). The screen lists them **read-only** (alias, provider type, display
name, enabled/disabled badge) and offers a **guarded delete** per provider — a confirmation dialog
(shared `DestructiveConfirmationDialog`/`useDestructiveOp`, `WARNING` tier: removing one social login
method does not affect other providers or username/password access) that, on confirm, calls
`DELETE /v1/tenants/{tenantId}/auth-config/identity-providers/{alias}` and reloads the config.

**Deferred follow-up:** creating or editing an identity provider
(`PUT /v1/tenants/{tenantId}/auth-config/identity-providers/{alias}`, which needs a provider-specific
form — OIDC/SAML endpoints, client id/secret, etc.) is **not** exposed by this screen yet. The backend
route already exists and is owner-authorized; a future change can add the write form once its UX is
scoped (tracked in `openspec/changes/add-console-auth-config-management/design.md`). Shipping a
read-only, correctly-populated list now is preferred over a partial/broken create form.

## The wire

`/v1/tenants/{tenantId}/auth-config` (and its `/identity-providers/{alias}` sub-resource) is a
**kind-CP runtime-only route family** (`deploy/kind/control-plane/routes.mjs`) — it is **not** present
in the public OpenAPI (`apps/control-plane/openapi/control-plane.openapi.json`) or the generated
console SDK (`apps/web-console/src/lib/console-openapi-sdk.ts`), the same pattern as the other
`/v1/tenants/*` runtime-only surfaces. There is therefore no OpenAPI/SDK contract artifact to update
for this change; `apps/web-console/src/services/authConfigApi.ts` **is** the console-side contract for
this surface, built on `requestConsoleSessionJson` (inherits the session bearer, 401-refresh-retry,
`X-API-Version`, and a fresh `Idempotency-Key` on every mutating call).

## Console states

The screen renders distinct states: **empty** (no active tenant selected — the operator is prompted to
choose one; no request is issued), **loading**, **blocked** (`403` — a localized "you don't have
permission" panel, never the raw backend message), **error** (any other failed `GET`, with a Retry
action), and the loaded form. Every error string is produced by the shared `describeConsoleError`
helper (`lib/console-errors.ts`) — per the console-wide policy (#743), the raw backend/transport
message is never echoed to the operator.
