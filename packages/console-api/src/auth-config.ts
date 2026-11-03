import type { JsonValue } from './http'
import { requestConsoleSessionJson } from './session'

// Tenant realm auth-config client (#782, #950). The four routed calls of
// apps/control-plane/routes.mjs, mirroring apps/web-console/src/services/authConfigApi.ts
// method, path and payload shape. The path family is runtime-only: it is not in the published
// OpenAPI, so these types are the console-side contract (gap-falcone-routed-unpublished).
// It lives beside `clients` because the clients entry pins its exact export list.
const enc = encodeURIComponent

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

// PUT body: only the changed login-method booleans. The server rejects a body with none of them.
export type TenantAuthConfigBooleanPatch = Partial<Record<TenantAuthConfigBooleanKey, boolean>>

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

const authConfigBase = (tenantId: string) => `/v1/tenants/${enc(tenantId)}/auth-config`
const identityProviderPath = (tenantId: string, alias: string) => `${authConfigBase(tenantId)}/identity-providers/${enc(alias)}`

export function getTenantAuthConfig(tenantId: string, signal?: AbortSignal): Promise<TenantAuthConfig> {
  return requestConsoleSessionJson<TenantAuthConfig>(authConfigBase(tenantId), { signal })
}

export function updateTenantAuthConfig(tenantId: string, patch: TenantAuthConfigBooleanPatch): Promise<TenantAuthConfig> {
  return requestConsoleSessionJson<TenantAuthConfig>(authConfigBase(tenantId), { method: 'PUT', body: patch as unknown as JsonValue })
}

// The secret is a write-only request field. Responses report presence only.
export function upsertTenantIdentityProvider(tenantId: string, alias: string, patch: TenantIdentityProviderPatch): Promise<{ identityProviders: TenantIdentityProvider[] }> {
  return requestConsoleSessionJson<{ identityProviders: TenantIdentityProvider[] }>(identityProviderPath(tenantId, alias), { method: 'PUT', body: patch as unknown as JsonValue })
}

export function deleteTenantIdentityProvider(tenantId: string, alias: string): Promise<unknown> {
  return requestConsoleSessionJson<unknown>(identityProviderPath(tenantId, alias), { method: 'DELETE' })
}
