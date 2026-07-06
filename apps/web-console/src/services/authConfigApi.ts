// Tenant realm auth-config data client for the console (change: add-console-auth-config-management,
// #782). A tenant owner's realm login behavior (registration, email login, password reset,
// remember-me, email verification, and the configured social identity providers) is fully
// manageable server-side via `GET`/`PUT /v1/tenants/{tenantId}/auth-config` (owner/admin/superadmin
// authorized via `authorizeAuthConfig` — `deploy/kind/control-plane/b-handlers.mjs`), but until now
// no console page called it. This client is built on `requestConsoleSessionJson` (mirroring
// `secretsApi.ts`) so every call inherits the session bearer, the 401-refresh-retry,
// `X-API-Version`, and (for the mutating calls) a fresh `Idempotency-Key` — no per-call header
// plumbing.
//
// This is a kind-CP RUNTIME-ONLY route family: `/v1/tenants/{tenantId}/auth-config` (and its
// `/identity-providers/{alias}` sub-resource) is NOT present in the public OpenAPI
// (`apps/control-plane/openapi/control-plane.openapi.json`) or the generated console SDK
// (`lib/console-openapi-sdk.ts`) — same pattern as the other `/v1/tenants/*` runtime surfaces (see
// `deploy/kind/control-plane/routes.mjs`). There is therefore no contract artifact to keep in sync;
// this module IS the console-side contract for this surface.
import { requestConsoleSessionJson } from '@/lib/console-session'
import type { JsonValue } from '@/lib/http'

const enc = encodeURIComponent

// A social/federated identity provider configured on the tenant's realm (Keycloak
// `identity-provider/instances`, shaped by `kc-admin.mjs::listIdentityProviders`).
export interface TenantIdentityProvider {
  alias: string
  providerId: string
  enabled: boolean
  displayName: string | null
}

// GET/PUT response shape (`b-handlers.mjs::getAuthConfig`/`setAuthConfig` spread
// `kc.getRealmAuthConfig`).
export interface TenantAuthConfig {
  tenantId: string
  realm: string
  registrationAllowed: boolean
  loginWithEmailAllowed: boolean
  resetPasswordAllowed: boolean
  rememberMe: boolean
  verifyEmail: boolean
  identityProviders: TenantIdentityProvider[]
}

export type TenantAuthConfigBooleanKey =
  | 'registrationAllowed'
  | 'loginWithEmailAllowed'
  | 'resetPasswordAllowed'
  | 'rememberMe'
  | 'verifyEmail'

// PUT body: a partial patch of ONLY the 5 booleans — the server honors nothing else and 400s when
// none of these keys is present (`setAuthConfig`'s `allowed` allow-list).
export type TenantAuthConfigBooleanPatch = Partial<Record<TenantAuthConfigBooleanKey, boolean>>

const authConfigBase = (tenantId: string) => `/v1/tenants/${enc(tenantId)}/auth-config`
const identityProviderPath = (tenantId: string, alias: string) => `${authConfigBase(tenantId)}/identity-providers/${enc(alias)}`

// GET …/auth-config — current realm login settings + configured social identity providers.
export function getTenantAuthConfig(tenantId: string): Promise<TenantAuthConfig> {
  return requestConsoleSessionJson<TenantAuthConfig>(authConfigBase(tenantId))
}

// PUT …/auth-config — partial patch of the 5 booleans; the server returns the full, persisted
// config (never a partial echo), so the caller re-seeds its state from the response.
export function updateTenantAuthConfig(
  tenantId: string,
  patch: TenantAuthConfigBooleanPatch
): Promise<TenantAuthConfig> {
  return requestConsoleSessionJson<TenantAuthConfig>(authConfigBase(tenantId), {
    method: 'PUT',
    body: patch as unknown as JsonValue
  })
}

// DELETE …/auth-config/identity-providers/{alias} — remove a configured social identity provider.
// (Create/update of a provider is intentionally NOT exposed by the console yet — see the
// `add-console-auth-config-management` OpenSpec change's design notes for the deferred follow-up.)
export function deleteTenantIdentityProvider(tenantId: string, alias: string): Promise<unknown> {
  return requestConsoleSessionJson<unknown>(identityProviderPath(tenantId, alias), {
    method: 'DELETE'
  })
}
