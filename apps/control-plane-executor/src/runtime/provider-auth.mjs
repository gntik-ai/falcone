import { clientError } from './errors.mjs';

const invalid = () => clientError('Invalid LLM provider auth configuration', 400, 'INVALID_LLM_PROVIDER_AUTH');
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\r\n]/.test(value);
function ref(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['name', 'workspaceSecret'].includes(key))
    || (text(value.name) === text(value.workspaceSecret))) throw invalid();
  return { ...value };
}
export function normalizeProviderAuth(auth) {
  if (auth === undefined || auth === null) return undefined;
  if (typeof auth !== 'object' || Array.isArray(auth)) throw invalid();
  const fields = auth.mode === 'apiKey' ? ['mode'] : auth.mode === 'workloadIdentity' ? ['mode', 'profile']
    : ['mode', 'grantType', 'tokenEndpoint', 'clientId', 'clientSecretRef', 'refreshTokenRef', 'scopes', 'audience'];
  if (Object.keys(auth).some(key => !fields.includes(key))) throw invalid();
  if (auth.mode === 'apiKey') return { mode: 'apiKey' };
  if (auth.mode === 'workloadIdentity') {
    if (!text(auth.profile) || !/^[A-Za-z0-9_-]{1,64}$/.test(auth.profile)) throw invalid();
    return { mode: auth.mode, profile: auth.profile };
  }
  if (auth.mode !== 'oauth2' || !['client_credentials', 'refresh_token'].includes(auth.grantType)
    || !text(auth.tokenEndpoint) || !text(auth.clientId)
    || (auth.scopes !== undefined && (!Array.isArray(auth.scopes) || auth.scopes.length > 64 || auth.scopes.some(scope => !text(scope) || /\s/.test(scope))))
    || (auth.audience !== undefined && !text(auth.audience))) throw invalid();
  const normalized = { mode: auth.mode, grantType: auth.grantType, tokenEndpoint: auth.tokenEndpoint, clientId: auth.clientId,
    clientSecretRef: ref(auth.clientSecretRef) };
  if (auth.grantType === 'refresh_token') normalized.refreshTokenRef = ref(auth.refreshTokenRef);
  else if (auth.refreshTokenRef !== undefined) throw invalid();
  if (auth.scopes !== undefined) normalized.scopes = [...auth.scopes];
  if (auth.audience !== undefined) normalized.audience = auth.audience;
  return normalized;
}
export function identityProfile(auth, tenantId, profiles, statusCode = 422) {
  const profile = Object.hasOwn(profiles, auth.profile) ? profiles[auth.profile] : undefined;
  if (!profile || !Array.isArray(profile.tenantAllowList) || !profile.tenantAllowList.includes(tenantId)
    || !text(profile.tokenEndpoint) || !text(profile.audience)
    || !['token-exchange', 'jwt-bearer'].includes(profile.grantType ?? 'token-exchange')) {
    throw clientError('LLM identity profile is not allowed', statusCode, 'LLM_IDENTITY_PROFILE_NOT_ALLOWED');
  }
  return profile;
}
