// Tenant realm auth-config data client for the console (change: add-console-auth-config-management,
// #782). A tenant owner's realm login behavior (registration, email login, password reset,
// remember-me, email verification, and the configured social identity providers) is fully
// manageable server-side via `GET`/`PUT /v1/tenants/{tenantId}/auth-config` (owner/admin/superadmin
// authorized via `authorizeAuthConfig` — `apps/control-plane/b-handlers.mjs`), but until now
// no console page called it. This client is built on `requestConsoleSessionJson` (mirroring
// `secretsApi.ts`) so every call inherits the session bearer, the 401-refresh-retry,
// `X-API-Version`, and (for the mutating calls) a fresh `Idempotency-Key` — no per-call header
// plumbing.
//
// This is a kind-CP RUNTIME-ONLY route family: `/v1/tenants/{tenantId}/auth-config` (and its
// `/identity-providers/{alias}` sub-resource) is NOT present in the public OpenAPI
// (`apps/control-plane-executor/openapi/control-plane.openapi.json`) or the generated console SDK
// (`lib/console-openapi-sdk.ts`) — same pattern as the other `/v1/tenants/*` runtime surfaces (see
// `apps/control-plane/routes.mjs`). There is therefore no contract artifact to keep in sync;
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
  clientId: string | null
  defaultScope: string | null
  clientSecretSet: boolean
  callbackUrl: string | null
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

export const SOCIAL_PROVIDER_TEMPLATES = [
  { id: 'google', label: 'Google' },
  { id: 'github', label: 'GitHub' },
  { id: 'microsoft', label: 'Microsoft' },
  { id: 'gitlab', label: 'GitLab' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'linkedin-openid-connect', label: 'LinkedIn' }
] as const

export interface TenantIdentityProviderPatch {
  providerId: string
  enabled?: boolean
  displayName?: string
  config?: { clientId?: string; clientSecret?: string; defaultScope?: string }
}

// The secret is a write-only request field. Responses contain presence evidence only.
export function upsertTenantIdentityProvider(tenantId: string, alias: string, patch: TenantIdentityProviderPatch): Promise<{ identityProviders: TenantIdentityProvider[] }> {
  return requestConsoleSessionJson(identityProviderPath(tenantId, alias), {
    method: 'PUT', body: patch as unknown as JsonValue
  })
}

// DELETE …/auth-config/identity-providers/{alias} — guarded by the console confirmation dialog.
export function deleteTenantIdentityProvider(tenantId: string, alias: string): Promise<unknown> {
  return requestConsoleSessionJson<unknown>(identityProviderPath(tenantId, alias), {
    method: 'DELETE'
  })
}
