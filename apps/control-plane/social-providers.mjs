// Only built-in social templates; tenant-supplied OIDC/SAML endpoints are excluded.
export const SOCIAL_PROVIDER_IDS = ['google', 'github', 'microsoft', 'gitlab', 'facebook', 'linkedin-openid-connect'];
const CONFIG_KEYS = new Set(['clientId', 'clientSecret', 'defaultScope']);
export const isMaskedSecret = (value) => typeof value === 'string' && /^\*+$/.test(value);

export function validateSocialProvider(alias, body) {
  if (typeof alias !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(alias)) return 'Invalid identity-provider alias';
  if (!SOCIAL_PROVIDER_IDS.includes(body.providerId ?? alias)) return 'Unsupported social providerId';
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return 'enabled must be boolean';
  if (body.displayName !== undefined && (typeof body.displayName !== 'string' || body.displayName.length > 256)) return 'Invalid displayName';
  const config = body.config ?? {};
  if (typeof config !== 'object' || Array.isArray(config)) return 'config must be an object';
  if (Object.keys(config).some((key) => !CONFIG_KEYS.has(key))) return 'Unsupported social provider config key';
  if (Object.values(config).some((value) => typeof value !== 'string' || value.length > 4096)) return 'config values must be strings of at most 4096 characters';
  if ('clientId' in config && !config.clientId.trim()) return 'clientId must not be empty';
  if (isMaskedSecret(config.clientSecret)) return 'A masked clientSecret cannot be submitted';
  return null;
}

export function socialProviderView(provider, realm, env = process.env) {
  // KEYCLOAK_ISSUER is the existing control-plane public issuer setting. Never use
  // the internal admin base as a public hostname or guess when the setting is absent.
  let base = null;
  try {
    const issuer = new URL(env.KEYCLOAK_ISSUER);
    if (['https:', 'http:'].includes(issuer.protocol) && !issuer.username && !issuer.password
      && /\/realms\/[^/]+\/?$/.test(issuer.pathname)) {
      base = issuer.origin + issuer.pathname.replace(/\/realms\/[^/]+\/?$/, '');
    }
  } catch { /* unset or invalid public issuer */ }
  return {
    alias: provider.alias, providerId: provider.providerId,
    enabled: provider.enabled !== false, displayName: provider.displayName ?? null,
    clientId: provider.clientId ?? provider.config?.clientId ?? null,
    defaultScope: provider.defaultScope ?? provider.config?.defaultScope ?? null,
    clientSecretSet: provider.clientSecretSet === true || Boolean(provider.config?.clientSecret),
    callbackUrl: base ? `${base}/realms/${encodeURIComponent(realm)}/broker/${encodeURIComponent(provider.alias)}/endpoint` : null,
  };
}

export function mergeSocialProvider(current, patch) {
  const config = { ...(current?.config ?? {}) };
  // A masked read cannot be safely merged into a replacement config. Fail closed
  // without a new secret: neither omission nor literal stars may wipe credentials.
  if (isMaskedSecret(config.clientSecret)) {
    if (!patch.config?.clientSecret || isMaskedSecret(patch.config.clientSecret)) {
      const error = new Error('Cannot safely preserve a masked identity-provider secret');
      error.code = 'MASKED_IDENTITY_PROVIDER_SECRET';
      throw error;
    }
    delete config.clientSecret;
  }
  for (const [key, value] of Object.entries(patch.config ?? {})) {
    if (key === 'clientSecret' && (!value || isMaskedSecret(value))) continue;
    config[key] = value;
  }
  return { ...current, ...patch, enabled: patch.enabled ?? current?.enabled ?? true,
    displayName: patch.displayName ?? current?.displayName ?? patch.alias, config };
}
