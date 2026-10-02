# Tenant realm auth-config — console screen

Every tenant is provisioned with its own Keycloak realm, and that realm's **login behavior**
(registration, email login, password reset, remember-me, email verification, and configured social
identity providers) has always been fully manageable server-side via
`GET`/`PUT /v1/tenants/{tenantId}/auth-config` (`apps/control-plane/b-handlers.mjs::getAuthConfig`
/ `setAuthConfig`, `authorizeAuthConfig`). Until this change, however, no console screen called it — a
tenant owner had no way to change their own realm's login settings without raw API access (#782).

This page documents the **Autenticación de la organización** console screen
(`/console/auth-config`, `apps/web-console/src/pages/ConsoleAuthConfigPage.tsx`) and the client it is
built on (`apps/web-console/src/services/authConfigApi.ts`).

The screen is distinct from the existing superadmin-only **Autenticación** screen (`/console/auth`,
`ConsoleAuthPage.tsx`), which is a realm/IAM **inventory** view (users/roles/scopes/clients) plus
external-application management and is gated to `superadmin` (owners are redirected away from it,
per issue #740). `/console/auth-config` is the **opposite**: a tenant owner/admin-reachable surface for that
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

Authorized roles (`superadmin`, `tenant_owner`, `tenant_admin`) can create from a template,
edit, enable/disable and delete providers. All management controls, including login-setting
writes, use `tenant.auth-config.manage` from `lib/console-permissions`; workspace and platform
operator roles do not inherit this permission. Server authorization remains
`authorizeAuthConfig` / `canManageTenant`. Non-admin roles see a read-only view if data is
available; the current server also refuses their GET with 403.

Supported built-in templates are `google`, `github`, `microsoft`, `gitlab`, `facebook`, and
`linkedin-openid-connect`. Generic OIDC/SAML endpoints are excluded. Aliases match
`[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}`. The create dialog rejects duplicate aliases, while the API
remains idempotent on alias. The template of an existing provider cannot change.

`PUT /v1/tenants/{tenantId}/auth-config/identity-providers/{alias}` accepts `providerId`,
`displayName`, `enabled`, and only `clientId`, `clientSecret`, `defaultScope` in `config`.
Unknown templates/config keys or invalid aliases return `400 VALIDATION_ERROR` before Keycloak
I/O; creating without both credentials returns 400 with no Keycloak write. Existing callers
sending other config keys must migrate to this narrower contract. Existing Keycloak config
keys are retained when merging an edit.

The client secret is write-only: it stays in an uncontrolled password input, is cleared before
awaiting the request, and is never placed in React state or browser storage. An empty edit
omits `clientSecret`; the adapter preserves the existing secret. A non-empty edit replaces it.
Reads and PUT responses expose only `clientSecretSet`, `clientId`, `defaultScope`, and provider
metadata, never the secret. Upstream social-provider error bodies are discarded, and audit
records carry route, tenant and outcome metadata only (`tenant.social-provider.upsert`).

If the direct Keycloak admin read returns a masked secret such as `**********`, an edit without
a replacement fails closed with 409 and makes no write. This prevents either a mask or an
omitted config entry from overwriting the stored credential. The deployed Keycloak version's
masking behavior must be revalidated in staging before release; a mask must never be stored as
a literal secret. Supplying a real replacement works even when the old read is masked.

Each provider includes `callbackUrl`. It derives the public base (including any context path)
from the existing control-plane `KEYCLOAK_ISSUER` setting and renders
`{publicKeycloakBase}/realms/{realm}/broker/{alias}/endpoint`. No internal admin hostname is
used. When the issuer is absent or invalid, the value is null and the console displays the
path pattern for operator setup. A configured URL has a copy action. Deployment wiring, if
needed, belongs in the deployment repository and must use existing values and secret gates.

Deletion retains the existing shared `DestructiveConfirmationDialog` / `useDestructiveOp`
confirmation, then calls DELETE and reloads the list. Enable/disable sends a PUT patch containing
only `providerId` and `enabled`. Test-connection and a browser OAuth round-trip remain follow-ups.

## The wire

`/v1/tenants/{tenantId}/auth-config` (and its `/identity-providers/{alias}` sub-resource) is a
**kind-CP runtime-only route family** (`apps/control-plane/routes.mjs`) — it is **not** present
in the public OpenAPI (`apps/control-plane-executor/openapi/control-plane.openapi.json`) or the generated
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
