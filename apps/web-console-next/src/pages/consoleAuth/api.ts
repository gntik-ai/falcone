import { createRequestId, type ApiError, type JsonValue } from '@in-falcone/console-api/http'
import { requestConsoleSessionJson } from '@in-falcone/console-api/session'

// Every call keeps the method, path, query and payload shape of the legacy ConsoleAuthPage
// (apps/web-console/src/pages/ConsoleAuthPage.tsx) and goes through the shared session client.
export type Protocol = 'openid-connect' | 'saml'
export interface IamScope { scopeName: string; protocol: Protocol; isDefault: boolean; isOptional: boolean; includeInTokenScope: boolean; assignedClientIds?: string[] }
export interface IamClient { clientId: string; protocol: Protocol; accessType: 'public' | 'confidential' | 'bearer_only'; enabled: boolean; state: string; redirectUris?: string[]; defaultScopes?: string[]; optionalScopes?: string[] }
export type Flow = 'oidc_authorization_code_pkce' | 'oidc_authorization_code_client_secret' | 'oidc_client_credentials' | 'saml_sp_initiated' | 'saml_idp_initiated'
export const FLOWS: Flow[] = ['oidc_authorization_code_pkce', 'oidc_authorization_code_client_secret', 'oidc_client_credentials', 'saml_sp_initiated', 'saml_idp_initiated']
export type ProviderMode = 'metadata_url' | 'inline_metadata' | 'manual_endpoints'
export interface Provider {
  providerId: string; alias: string; displayName: string; protocol: 'oidc' | 'saml'; providerMode: ProviderMode; enabled?: boolean
  authorizationUrl?: string; tokenUrl?: string; userInfoUrl?: string; requestedScopes?: string[]; metadataUrl?: string; metadataXml?: string
  entityId?: string; issuer?: string; ssoServiceUrl?: string; sloServiceUrl?: string; metadata?: Record<string, string>
}
export interface Application {
  applicationId: string; entityType?: 'external_application'; displayName: string; slug: string; protocol: 'oidc' | 'saml' | 'api_key'; state: string
  authenticationFlows?: Flow[]; redirectUris?: string[]; scopes?: { scopeName: string; consentRequired?: boolean; description?: string }[]
  federatedProviders?: Provider[]; validation?: { status: 'valid' | 'warning' | 'invalid' | 'pending' }
  login?: { allowIdpInitiated?: boolean; defaultProviderAlias?: string; defaultRedirectUri?: string; initiateLoginUri?: string; redirectUris?: string[] }
  logout?: { backChannelLogoutUri?: string; frontChannelLogoutUri?: string; postLogoutRedirectUris?: string[]; signedRequestsRequired?: boolean }
  metadata?: Record<string, string>
}
export interface Failure { status?: number; requestId?: string }
export type RealmSection = 'users' | 'roles' | 'scopes' | 'clients'
export interface RealmData { users: number; roles: number; scopes: IamScope[]; clients: IamClient[] }

export function failureOf(cause: unknown): Failure {
  const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
  return { status: typeof error.status === 'number' ? error.status : undefined, requestId: error.requestId ?? error.correlationId }
}
/** Network failures and transient HTTP responses can reasonably succeed on another request. */
export function isRetryable(failure: Failure): boolean {
  const { status } = failure
  return status === undefined || status === 408 || status === 429 || status >= 500
}

export async function loadRealmSection(realmId: string, section: RealmSection, signal: AbortSignal): Promise<{ items?: unknown[] }> {
  return requestConsoleSessionJson<{ items?: unknown[] }>(`/v1/iam/realms/${realmId}/${section}?page[size]=100`, { method: 'GET', signal })
}
export async function listApplications(workspaceId: string, signal: AbortSignal): Promise<Application[]> {
  const response = await requestConsoleSessionJson<{ items?: Application[] }>(`/v1/workspaces/${workspaceId}/applications?limit=100`, { method: 'GET', signal })
  return response.items ?? []
}

export interface ApplicationForm { displayName: string; slug: string; protocol: 'oidc' | 'saml' | 'api_key'; redirectUris: string; logoutUrl: string; scopes: string; authenticationFlows: string[] }
export interface ProviderForm {
  providerId: string; alias: string; displayName: string; protocol: 'oidc' | 'saml'; providerMode: ProviderMode; enabled: boolean
  authorizationUrl: string; tokenUrl: string; userInfoUrl: string; requestedScopes: string; metadataUrl: string; metadataXml: string
  entityId: string; issuer: string; ssoServiceUrl: string; sloServiceUrl: string
}
export const EMPTY_APPLICATION: ApplicationForm = { displayName: '', slug: '', protocol: 'oidc', redirectUris: '', logoutUrl: '', scopes: '', authenticationFlows: [] }
export const EMPTY_PROVIDER: ProviderForm = {
  providerId: '', alias: '', displayName: '', protocol: 'oidc', providerMode: 'manual_endpoints', enabled: true, authorizationUrl: '', tokenUrl: '', userInfoUrl: '',
  requestedScopes: '', metadataUrl: '', metadataXml: '', entityId: '', issuer: '', ssoServiceUrl: '', sloServiceUrl: '',
}
export type FormErrors = Record<string, string>

const splitLines = (value: string) => value.split('\n').map((entry) => entry.trim()).filter(Boolean)
const splitCsv = (value: string) => value.split(',').map((entry) => entry.trim()).filter(Boolean)
function isValidUrl(value: string) { try { new URL(value); return true } catch { return false } }

// Values are validation message keys under `validation.` in the page namespace.
export function validateApplication(form: ApplicationForm): FormErrors {
  const errors: FormErrors = {}
  if (!form.displayName.trim()) errors.displayName = 'nameRequired'
  if (!form.slug.trim()) errors.slug = 'slugRequired'
  else if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(form.slug.trim())) errors.slug = 'slugFormat'
  const redirectUris = splitLines(form.redirectUris)
  if (redirectUris.length === 0) errors.redirectUris = 'redirectRequired'
  else if (redirectUris.some((uri) => !isValidUrl(uri))) errors.redirectUris = 'redirectInvalid'
  if (form.logoutUrl.trim() && !isValidUrl(form.logoutUrl.trim())) errors.logoutUrl = 'logoutInvalid'
  return errors
}
export function validateProvider(form: ProviderForm): FormErrors {
  const errors: FormErrors = {}
  if (!form.providerId.trim()) errors.providerId = 'providerIdRequired'
  if (!form.alias.trim()) errors.alias = 'aliasRequired'
  if (!form.displayName.trim()) errors.displayName = 'providerNameRequired'
  if (form.providerMode === 'metadata_url') {
    if (!form.metadataUrl.trim()) errors.metadataUrl = 'metadataUrlRequired'
    else if (!isValidUrl(form.metadataUrl.trim())) errors.metadataUrl = 'metadataUrlInvalid'
  }
  if (form.providerMode === 'inline_metadata' && form.protocol === 'saml' && form.metadataXml.trim().length < 32) errors.metadataXml = 'metadataXmlShort'
  if (form.protocol === 'oidc' && form.providerMode === 'manual_endpoints') {
    if (!form.authorizationUrl.trim() || !isValidUrl(form.authorizationUrl.trim())) errors.authorizationUrl = 'authorizationUrlInvalid'
    if (!form.tokenUrl.trim() || !isValidUrl(form.tokenUrl.trim())) errors.tokenUrl = 'tokenUrlInvalid'
    if (form.userInfoUrl.trim() && !isValidUrl(form.userInfoUrl.trim())) errors.userInfoUrl = 'userInfoUrlInvalid'
  }
  if (form.protocol === 'saml' && form.providerMode === 'manual_endpoints') {
    if (!form.entityId.trim()) errors.entityId = 'entityIdRequired'
    if (!form.ssoServiceUrl.trim() || !isValidUrl(form.ssoServiceUrl.trim())) errors.ssoServiceUrl = 'ssoUrlInvalid'
    if (form.sloServiceUrl.trim() && !isValidUrl(form.sloServiceUrl.trim())) errors.sloServiceUrl = 'sloUrlInvalid'
  }
  return errors
}

export function toApplicationForm(application: Application): ApplicationForm {
  return {
    displayName: application.displayName, slug: application.slug, protocol: application.protocol,
    redirectUris: (application.redirectUris ?? application.login?.redirectUris ?? []).join('\n'),
    logoutUrl: application.logout?.frontChannelLogoutUri ?? '',
    scopes: (application.scopes ?? []).map((scope) => scope.scopeName).join(', '),
    authenticationFlows: application.authenticationFlows ?? [],
  }
}
export function buildApplicationPayload(form: ApplicationForm, existing?: Application | null) {
  const redirectUris = splitLines(form.redirectUris)
  return {
    entityType: 'external_application' as const,
    displayName: form.displayName.trim(),
    slug: form.slug.trim(),
    protocol: form.protocol,
    desiredState: (existing?.state as 'active' | 'soft_deleted' | undefined) ?? 'active',
    metadata: existing?.metadata ?? { managedBy: 'web-console', surface: 'console-auth' },
    redirectUris,
    login: { ...(existing?.login ?? {}), redirectUris, defaultRedirectUri: redirectUris[0] },
    logout: form.logoutUrl.trim() ? { ...(existing?.logout ?? {}), frontChannelLogoutUri: form.logoutUrl.trim(), postLogoutRedirectUris: [form.logoutUrl.trim()] } : existing?.logout,
    scopes: splitCsv(form.scopes).map((scopeName) => ({ scopeName })),
    authenticationFlows: form.authenticationFlows,
    federatedProviders: existing?.federatedProviders ?? [],
  }
}
export function toProviderForm(provider: Provider): ProviderForm {
  return {
    providerId: provider.providerId, alias: provider.alias, displayName: provider.displayName, protocol: provider.protocol, providerMode: provider.providerMode, enabled: provider.enabled ?? true,
    authorizationUrl: provider.authorizationUrl ?? '', tokenUrl: provider.tokenUrl ?? '', userInfoUrl: provider.userInfoUrl ?? '', requestedScopes: (provider.requestedScopes ?? []).join(', '),
    metadataUrl: provider.metadataUrl ?? '', metadataXml: provider.metadataXml ?? '', entityId: provider.entityId ?? '', issuer: provider.issuer ?? '',
    ssoServiceUrl: provider.ssoServiceUrl ?? '', sloServiceUrl: provider.sloServiceUrl ?? '',
  }
}
export function buildProviderPayload(form: ProviderForm): Provider {
  return {
    providerId: form.providerId.trim(), alias: form.alias.trim(), displayName: form.displayName.trim(), protocol: form.protocol, providerMode: form.providerMode, enabled: form.enabled,
    authorizationUrl: form.authorizationUrl.trim() || undefined, tokenUrl: form.tokenUrl.trim() || undefined, userInfoUrl: form.userInfoUrl.trim() || undefined,
    requestedScopes: splitCsv(form.requestedScopes), metadataUrl: form.metadataUrl.trim() || undefined, metadataXml: form.metadataXml.trim() || undefined,
    entityId: form.entityId.trim() || undefined, issuer: form.issuer.trim() || undefined, ssoServiceUrl: form.ssoServiceUrl.trim() || undefined, sloServiceUrl: form.sloServiceUrl.trim() || undefined,
    metadata: { managedBy: 'web-console', surface: 'console-auth' },
  }
}

const applications = (workspaceId: string) => `/v1/workspaces/${workspaceId}/applications`
const json = (payload: unknown) => payload as JsonValue
export async function saveApplication(workspaceId: string, form: ApplicationForm, existing: Application | null): Promise<void> {
  const body = json(buildApplicationPayload(form, existing))
  if (existing) await requestConsoleSessionJson(`${applications(workspaceId)}/${existing.applicationId}`, { method: 'PUT', body })
  else await requestConsoleSessionJson(applications(workspaceId), { method: 'POST', body, idempotent: true })
}
export async function softDeleteApplication(workspaceId: string, application: Application): Promise<void> {
  await requestConsoleSessionJson(`${applications(workspaceId)}/${application.applicationId}`, {
    method: 'PUT', body: json({ ...buildApplicationPayload(toApplicationForm(application), application), desiredState: 'soft_deleted' }),
  })
}
export async function saveProvider(workspaceId: string, application: Application, form: ProviderForm, editingId: string | null): Promise<void> {
  const body = json(buildProviderPayload(form))
  const base = `${applications(workspaceId)}/${application.applicationId}/federation/providers`
  if (editingId) await requestConsoleSessionJson(`${base}/${editingId}`, { method: 'PUT', body })
  else await requestConsoleSessionJson(base, { method: 'POST', body, idempotent: true })
}
export async function toggleProvider(workspaceId: string, application: Application, provider: Provider): Promise<void> {
  await requestConsoleSessionJson(`${applications(workspaceId)}/${application.applicationId}/federation/providers/${provider.providerId}`, {
    method: 'PUT', body: json({ ...provider, enabled: !(provider.enabled ?? true) }),
  })
}
export async function detachProvider(workspaceId: string, application: Application, provider: Provider): Promise<void> {
  const federatedProviders = (application.federatedProviders ?? []).filter((item) => item.providerId !== provider.providerId)
  await requestConsoleSessionJson(`${applications(workspaceId)}/${application.applicationId}`, {
    method: 'PUT', body: json({ ...buildApplicationPayload(toApplicationForm(application), application), federatedProviders }),
  })
}

export interface IamClientData { clientType: string; clientId: string; redirectUris: string; scopes: string[] }
// A confidential client answers with a one-time secret. It is never read: only the client id is kept.
export async function createIamClient(workspaceId: string, data: IamClientData): Promise<string> {
  const response = await requestConsoleSessionJson<{ iamClientId?: string }>(`/v1/workspaces/${workspaceId}/iam/clients`, {
    method: 'POST', idempotent: true, headers: { 'X-Request-Id': createRequestId('wiz') },
    body: {
      clientType: data.clientType || 'public', clientId: data.clientId,
      redirectUris: data.clientType === 'service_account' ? [] : data.redirectUris.split(',').map((item) => item.trim()).filter(Boolean),
      scopes: data.scopes, permissions: [],
    },
  })
  return String(response?.iamClientId ?? '')
}
