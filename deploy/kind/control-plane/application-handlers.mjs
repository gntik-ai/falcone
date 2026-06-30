import { randomUUID } from 'node:crypto';
import * as store from './tenant-store.mjs';
import { callerTenantScope, canManageTenant } from './tenant-scope.mjs';

const ok = (statusCode, body) => ({ statusCode, body });
const err = (statusCode, code, message, extra = {}) => ({ statusCode, body: { code, message, ...extra } });

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
const PROVIDER_ID_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
const PROTOCOLS = new Set(['oidc', 'saml', 'api_key']);
const PROVIDER_PROTOCOLS = new Set(['oidc', 'saml']);
const STATES = new Set(['draft', 'provisioning', 'pending_activation', 'active', 'suspended', 'soft_deleted', 'deleted']);
const PROVIDER_MODES = new Set(['metadata_url', 'inline_metadata', 'manual_endpoints']);
const FLOW_CATALOG = [
  { flowId: 'oidc_authorization_code_pkce', protocol: 'oidc' },
  { flowId: 'oidc_authorization_code_client_secret', protocol: 'oidc' },
  { flowId: 'oidc_client_credentials', protocol: 'oidc' },
  { flowId: 'saml_sp_initiated', protocol: 'saml' },
  { flowId: 'saml_idp_initiated', protocol: 'saml' },
];
const STARTER_TEMPLATES = [
  {
    templateId: 'tpl_spa_oidc_pkce',
    pattern: 'spa',
    protocol: 'oidc',
    name: 'SPA + OIDC PKCE starter',
    summary: 'Starter shape for browser applications using authorization code with PKCE.',
    supportedAuthenticationFlows: ['oidc_authorization_code_pkce'],
    exampleRequest: {
      entityType: 'external_application',
      slug: 'workspace-spa',
      displayName: 'Workspace SPA',
      protocol: 'oidc',
      desiredState: 'active',
      metadata: { pattern: 'spa' },
      authenticationFlows: ['oidc_authorization_code_pkce'],
      login: { redirectUris: ['https://spa.example.com/auth/callback'] },
      iamClient: { clientType: 'public' },
    },
  },
  {
    templateId: 'tpl_backend_oidc_confidential',
    pattern: 'confidential_backend',
    protocol: 'oidc',
    name: 'Confidential backend + OIDC starter',
    summary: 'Starter shape for server-side applications using client-secret backed OIDC flows.',
    supportedAuthenticationFlows: ['oidc_authorization_code_client_secret', 'oidc_client_credentials'],
    exampleRequest: {
      entityType: 'external_application',
      slug: 'workspace-api',
      displayName: 'Workspace API',
      protocol: 'oidc',
      desiredState: 'active',
      metadata: { pattern: 'confidential_backend' },
      authenticationFlows: ['oidc_authorization_code_client_secret', 'oidc_client_credentials'],
      login: { redirectUris: ['https://api.example.com/oauth/callback'] },
      iamClient: { clientType: 'confidential' },
    },
  },
  {
    templateId: 'tpl_b2b_saml',
    pattern: 'b2b_saml',
    protocol: 'saml',
    name: 'B2B SAML federation starter',
    summary: 'Starter shape for enterprise partner federation with SAML.',
    supportedAuthenticationFlows: ['saml_sp_initiated'],
    exampleRequest: {
      entityType: 'external_application',
      slug: 'partner-saml',
      displayName: 'Partner SAML',
      protocol: 'saml',
      desiredState: 'active',
      metadata: { pattern: 'b2b_saml' },
      authenticationFlows: ['saml_sp_initiated'],
      login: { redirectUris: ['https://partner.example.com/saml/acs'] },
      logout: { signedRequestsRequired: true },
      iamClient: { clientType: 'confidential' },
    },
  },
];

let iamHelpers = null;

async function loadExternalApplicationIam() {
  if (iamHelpers) return iamHelpers;
  const candidates = [
    '/repo/apps/control-plane/src/external-application-iam.mjs',
    new URL('../../../apps/control-plane/src/external-application-iam.mjs', import.meta.url).href,
  ];
  for (const candidate of candidates) {
    try {
      iamHelpers = await import(candidate);
      return iamHelpers;
    } catch {
      // Try the next runtime layout.
    }
  }
  iamHelpers = {
    listStarterTemplates: () => STARTER_TEMPLATES,
    validateExternalApplicationConfiguration: fallbackValidateExternalApplicationConfiguration,
  };
  return iamHelpers;
}

function newId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function clampLimit(value, fallback = 100) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.trunc(n), 200);
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => [k, typeof v === 'string' ? v : String(v)]),
  );
}

function collection(items, { pageSize = items.length || 1, nextCursor = null } = {}) {
  const size = Math.min(Math.max(Math.trunc(Number(pageSize)) || 1, 1), 200);
  return {
    items,
    page: {
      size,
      ...(nextCursor ? { after: String(nextCursor), nextCursor: String(nextCursor) } : {}),
    },
  };
}

function applicationOut(row) {
  const doc = row.app_json && typeof row.app_json === 'object' ? row.app_json : {};
  const {
    applicationId: _applicationId,
    tenantId: _tenantId,
    workspaceId: _workspaceId,
    entityType: _entityType,
    slug: _slug,
    protocol: _protocol,
    state: _state,
    desiredState: _desiredState,
    timestamps: _timestamps,
    metadata: _metadata,
    iamClient: _iamClient,
    ...rest
  } = doc;
  const createdAt = toIso(row.created_at);
  const updatedAt = toIso(row.updated_at ?? row.created_at);
  const login = rest.login && typeof rest.login === 'object' ? rest.login : {};
  const redirectUris = Array.isArray(rest.redirectUris)
    ? rest.redirectUris
    : (Array.isArray(login.redirectUris) ? login.redirectUris : []);

  const application = {
    ...rest,
    entityType: 'external_application',
    applicationId: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    slug: row.slug,
    displayName: rest.displayName ?? row.slug,
    protocol: row.protocol,
    redirectUris,
    state: row.state,
    timestamps: { createdAt, updatedAt },
    metadata: normalizeMetadata(_metadata),
    federatedProviders: Array.isArray(rest.federatedProviders) ? rest.federatedProviders : [],
  };
  const iamClient = defaultIamClient({ application: { ...application, iamClient: _iamClient } });
  if (iamClient) application.iamClient = iamClient;
  return application;
}

function validationCheck(code, message, fieldPath) {
  return { code, severity: 'error', message, fieldPath };
}

function isHttpsUri(value, { allowHttpLocalhost = true } = {}) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || (allowHttpLocalhost && parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname));
  } catch {
    return false;
  }
}

function fallbackValidateExternalApplicationConfiguration({ application = {} } = {}) {
  const checks = [];
  const flows = application.authenticationFlows ?? [];
  if (!['oidc', 'saml'].includes(application.protocol)) {
    checks.push(validationCheck('unsupported_protocol', 'Only OIDC and SAML federation are supported by this feature.', 'protocol'));
  }
  if (!Array.isArray(flows) || flows.length === 0) {
    checks.push(validationCheck('missing_authentication_flow', 'authenticationFlows must declare at least one supported flow.', 'authenticationFlows'));
  } else {
    for (const [index, flowId] of flows.entries()) {
      const flow = FLOW_CATALOG.find((item) => item.flowId === flowId);
      if (!flow) {
        checks.push(validationCheck('unknown_authentication_flow', `Unknown authentication flow ${flowId}.`, `authenticationFlows[${index}]`));
      } else if (flow.protocol !== application.protocol) {
        checks.push(validationCheck('authentication_flow_protocol_mismatch', `${flowId} is not compatible with protocol ${application.protocol}.`, `authenticationFlows[${index}]`));
      }
    }
  }
  const redirectUris = application.login?.redirectUris ?? [];
  if (!Array.isArray(redirectUris)) {
    checks.push(validationCheck('invalid_type', 'login.redirectUris must be an array of URIs.', 'login.redirectUris'));
  } else {
    for (const [index, uri] of redirectUris.entries()) {
      if (!isHttpsUri(uri)) checks.push(validationCheck('invalid_uri', 'login.redirectUris contains an invalid or non-HTTPS URI.', `login.redirectUris[${index}]`));
    }
  }
  if (application.protocol === 'oidc') {
    const clientType = application.iamClient?.clientType;
    if (!['public', 'confidential'].includes(clientType)) {
      checks.push(validationCheck('invalid_client_type', 'OIDC applications require a public or confidential iamClient.clientType.', 'iamClient.clientType'));
    }
    if (flows.includes('oidc_authorization_code_pkce') && clientType !== 'public') {
      checks.push(validationCheck('client_flow_mismatch', 'oidc_authorization_code_pkce requires a public client.', 'iamClient.clientType'));
    }
    if (flows.some((flowId) => ['oidc_authorization_code_client_secret', 'oidc_client_credentials'].includes(flowId)) && clientType !== 'confidential') {
      checks.push(validationCheck('client_flow_mismatch', 'Confidential OIDC flows require iamClient.clientType=confidential.', 'iamClient.clientType'));
    }
  }
  if (application.protocol === 'saml' && application.logout?.signedRequestsRequired !== true) {
    checks.push(validationCheck('missing_signed_logout', 'SAML applications require logout.signedRequestsRequired=true.', 'logout.signedRequestsRequired'));
  }
  const providers = Array.isArray(application.federatedProviders) ? application.federatedProviders : [];
  for (const [index, provider] of providers.entries()) {
    const fieldPath = `federatedProviders[${index}]`;
    const issuer = typeof provider?.issuer === 'string' ? provider.issuer.trim() : '';
    if (provider?.protocol === 'oidc' && !issuer && !isHttpsUri(provider.metadataUrl, { allowHttpLocalhost: false })) {
      checks.push(validationCheck('missing_oidc_discovery', 'OIDC providers must declare issuer or metadataUrl/discovery URL.', fieldPath));
    }
    if (provider?.protocol === 'saml') {
      const hasMetadata = isHttpsUri(provider.metadataUrl, { allowHttpLocalhost: false }) || (typeof provider.metadataXml === 'string' && provider.metadataXml.trim());
      const hasEndpoints = isHttpsUri(provider.ssoServiceUrl, { allowHttpLocalhost: false }) || isHttpsUri(provider.sloServiceUrl, { allowHttpLocalhost: false });
      if (!hasMetadata && !hasEndpoints) {
        checks.push(validationCheck('missing_saml_metadata', 'SAML providers require metadataUrl, metadataXml, or explicit SSO/SLO endpoints.', fieldPath));
      }
    }
  }
  return {
    ok: checks.length === 0,
    supportedFlows: FLOW_CATALOG.filter((flow) => !application.protocol || flow.protocol === application.protocol),
    starterTemplates: STARTER_TEMPLATES.filter((template) => !application.protocol || template.protocol === application.protocol),
    validation: { status: checks.length === 0 ? 'valid' : 'invalid', checks },
  };
}

function validationError(checks) {
  return err(400, 'VALIDATION_ERROR', 'external application configuration is invalid', {
    validation: { status: 'invalid', checks },
  });
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()) : [];
}

function defaultIamClient({ application, existing }) {
  const current = application.iamClient && typeof application.iamClient === 'object'
    ? { ...application.iamClient }
    : (existing?.iamClient && typeof existing.iamClient === 'object' ? { ...existing.iamClient } : {});
  if (application.protocol !== 'oidc') {
    if (!current.realm || !current.clientId || !current.clientType || !Array.isArray(current.defaultClientScopes)) return undefined;
  }
  const flows = application.authenticationFlows ?? [];
  if (!current.clientType) {
    current.clientType = flows.some((flow) => ['oidc_authorization_code_client_secret', 'oidc_client_credentials'].includes(flow))
      ? 'confidential'
      : 'public';
  }
  current.realm = current.realm ?? application.tenantId;
  current.clientId = current.clientId ?? application.slug;
  current.defaultClientScopes = stringArray(current.defaultClientScopes);
  if (current.defaultClientScopes.length === 0) current.defaultClientScopes = ['openid', 'profile'];
  const redirectUris = stringArray(current.redirectUris).length
    ? stringArray(current.redirectUris)
    : stringArray(application.login?.redirectUris ?? application.redirectUris);
  const optionalClientScopes = stringArray(current.optionalClientScopes);
  const webOrigins = stringArray(current.webOrigins);
  const postLogoutRedirectUris = stringArray(current.postLogoutRedirectUris ?? application.logout?.postLogoutRedirectUris);
  const protocolMappers = Array.isArray(current.protocolMappers) ? current.protocolMappers : [];

  return {
    realm: String(current.realm),
    clientId: String(current.clientId),
    clientType: current.clientType,
    defaultClientScopes: current.defaultClientScopes,
    ...(redirectUris.length ? { redirectUris } : {}),
    ...(optionalClientScopes.length ? { optionalClientScopes } : {}),
    ...(webOrigins.length ? { webOrigins } : {}),
    ...(postLogoutRedirectUris.length ? { postLogoutRedirectUris } : {}),
    ...(typeof current.frontChannelLogoutUri === 'string' && current.frontChannelLogoutUri.trim() ? { frontChannelLogoutUri: current.frontChannelLogoutUri.trim() } : {}),
    ...(typeof current.backChannelLogoutUri === 'string' && current.backChannelLogoutUri.trim() ? { backChannelLogoutUri: current.backChannelLogoutUri.trim() } : {}),
    ...(protocolMappers.length ? { protocolMappers } : {}),
  };
}

function normalizeApplicationBody(body = {}, { id, workspace, existing = null } = {}) {
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : existing?.displayName;
  const slug = typeof body.slug === 'string' ? body.slug.trim() : existing?.slug;
  const protocol = body.protocol ?? existing?.protocol;
  const state = body.desiredState ?? body.state ?? existing?.state ?? 'active';
  const redirectUris = Array.isArray(body.redirectUris)
    ? body.redirectUris
    : (Array.isArray(body.login?.redirectUris) ? body.login.redirectUris : (existing?.redirectUris ?? []));
  const login = {
    ...(existing?.login ?? {}),
    ...(body.login && typeof body.login === 'object' ? body.login : {}),
  };
  if (!Array.isArray(login.redirectUris)) login.redirectUris = redirectUris;
  if (!login.defaultRedirectUri && redirectUris.length > 0) login.defaultRedirectUri = redirectUris[0];

  const application = {
    ...(existing ?? {}),
    entityType: 'external_application',
    applicationId: id,
    tenantId: workspace.tenant_id,
    workspaceId: workspace.id,
    slug,
    displayName,
    protocol,
    state,
    redirectUris,
    serviceAccountIds: Array.isArray(body.serviceAccountIds) ? body.serviceAccountIds : (existing?.serviceAccountIds ?? []),
    exposedResourceIds: Array.isArray(body.exposedResourceIds) ? body.exposedResourceIds : (existing?.exposedResourceIds ?? []),
    metadata: normalizeMetadata(body.metadata ?? existing?.metadata),
    templateId: body.templateId ?? existing?.templateId,
    authenticationFlows: Array.isArray(body.authenticationFlows) ? body.authenticationFlows : (existing?.authenticationFlows ?? []),
    login,
    logout: body.logout && typeof body.logout === 'object' ? body.logout : (existing?.logout ?? {}),
    scopes: Array.isArray(body.scopes) ? body.scopes : (existing?.scopes ?? []),
    roles: Array.isArray(body.roles) ? body.roles : (existing?.roles ?? []),
    attributeMappers: Array.isArray(body.attributeMappers) ? body.attributeMappers : (existing?.attributeMappers ?? []),
    federatedProviders: Array.isArray(body.federatedProviders) ? body.federatedProviders : (existing?.federatedProviders ?? []),
    endpoints: Array.isArray(body.endpoints) ? body.endpoints : (existing?.endpoints ?? []),
  };
  const iamClient = body.iamClient ?? existing?.iamClient;
  if (iamClient) application.iamClient = iamClient;
  application.iamClient = defaultIamClient({ application, existing });
  return application;
}

async function validateApplicationForWrite(application, { planId } = {}) {
  const checks = [];
  if (application.entityType !== 'external_application') {
    checks.push(validationCheck('invalid_entity_type', 'entityType must be external_application.', 'entityType'));
  }
  if (!application.displayName) {
    checks.push(validationCheck('missing_display_name', 'displayName is required.', 'displayName'));
  }
  if (!SLUG_RE.test(String(application.slug ?? ''))) {
    checks.push(validationCheck('invalid_slug', 'slug must use lowercase letters, numbers, and hyphens.', 'slug'));
  }
  if (!PROTOCOLS.has(application.protocol)) {
    checks.push(validationCheck('unsupported_protocol', 'protocol must be oidc, saml, or api_key.', 'protocol'));
  }
  if (!STATES.has(application.state)) {
    checks.push(validationCheck('invalid_state', 'desiredState/state is not a supported entity state.', 'desiredState'));
  }
  if (checks.length > 0) return { ok: false, validation: { status: 'invalid', checks } };

  if (application.protocol === 'api_key') {
    return { ok: true, validation: { status: 'valid', checks: [] } };
  }

  const { validateExternalApplicationConfiguration } = await loadExternalApplicationIam();
  return validateExternalApplicationConfiguration({ application, planId });
}

function mutationAccepted(ctx, {
  entityId,
  tenantId,
  workspaceId,
  desiredState,
  eventType,
  mutationScope = 'entity',
  subresourceId = null,
}) {
  const correlationId = ctx.callerContext?.correlationId ?? newId('corr');
  return {
    commandId: newId('cmd'),
    requestId: newId('req'),
    entityType: 'external_application',
    entityId,
    tenantId,
    workspaceId,
    status: 'accepted',
    acceptedEventType: eventType,
    desiredState,
    correlationId,
    acceptedAt: new Date().toISOString(),
    mutationScope,
    ...(subresourceId ? { subresourceType: 'federated_provider', subresourceId } : {}),
  };
}

function isPlatformIdentity(identity) {
  return identity?.actorType === 'superadmin' || identity?.actorType === 'internal';
}

async function resolveWorkspace(ctx, { write = false } = {}) {
  const st = ctx.store ?? store;
  const workspaceId = ctx.params?.workspaceId;
  const scope = callerTenantScope(ctx.identity);
  if (scope == null && !isPlatformIdentity(ctx.identity)) {
    return { error: err(404, 'WORKSPACE_NOT_FOUND', `workspace ${workspaceId} not found`) };
  }
  const ws = await st.getWorkspace(ctx.pool, workspaceId);
  if (!ws || (scope != null && ws.tenant_id !== scope)) {
    return { error: err(404, 'WORKSPACE_NOT_FOUND', `workspace ${workspaceId} not found`) };
  }
  if (write && !canManageTenant(ctx.identity, ws.tenant_id)) {
    return { error: err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin of this workspace tenant') };
  }
  return { st, ws };
}

async function resolveApplication(ctx, { write = false } = {}) {
  const resolved = await resolveWorkspace(ctx, { write });
  if (resolved.error) return resolved;
  const app = await resolved.st.getExternalApplication(ctx.pool, {
    workspaceId: resolved.ws.id,
    tenantId: resolved.ws.tenant_id,
    applicationId: ctx.params?.applicationId,
  });
  if (!app) return { error: err(404, 'APPLICATION_NOT_FOUND', `application ${ctx.params?.applicationId} not found`) };
  return { ...resolved, app, application: applicationOut(app) };
}

function mapPersistenceError(error, slug) {
  if (error?.code === '23505') {
    return err(409, 'APPLICATION_SLUG_TAKEN', `external application slug '${slug}' already exists in workspace`);
  }
  throw error;
}

// GET /v1/workspaces/{workspaceId}/applications
export async function listExternalApplications(ctx) {
  const resolved = await resolveWorkspace(ctx);
  if (resolved.error) return resolved.error;
  const limit = clampLimit(ctx.query?.limit ?? ctx.query?.['page[size]']);
  const offset = Number(ctx.query?.offset ?? 0) || 0;
  const res = await resolved.st.listExternalApplications(ctx.pool, {
    workspaceId: resolved.ws.id,
    tenantId: resolved.ws.tenant_id,
    limit,
    offset,
    protocol: ctx.query?.protocol ?? null,
    state: ctx.query?.state ?? null,
  });
  return ok(200, collection(res.items.map(applicationOut), { pageSize: limit }));
}

// GET /v1/workspaces/{workspaceId}/applications/templates
export async function listExternalApplicationStarterTemplates(ctx) {
  const resolved = await resolveWorkspace(ctx);
  if (resolved.error) return resolved.error;
  const { listStarterTemplates } = await loadExternalApplicationIam();
  const items = listStarterTemplates({ planId: ctx.query?.planId });
  return ok(200, collection(items));
}

// POST /v1/workspaces/{workspaceId}/applications
export async function createExternalApplication(ctx) {
  const resolved = await resolveWorkspace(ctx, { write: true });
  if (resolved.error) return resolved.error;
  const applicationId = newId('app');
  const app = normalizeApplicationBody(ctx.body, { id: applicationId, workspace: resolved.ws });
  const validation = await validateApplicationForWrite(app, { planId: ctx.body?.planId ?? app.metadata?.planId });
  if (!validation.ok) return validationError(validation.validation.checks);
  app.validation = validation.validation;

  let row;
  try {
    row = await resolved.st.upsertExternalApplication(ctx.pool, {
      id: applicationId,
      workspaceId: resolved.ws.id,
      tenantId: resolved.ws.tenant_id,
      slug: app.slug,
      protocol: app.protocol,
      state: app.state,
      appJson: app,
      actorId: ctx.identity?.sub ?? null,
    });
  } catch (error) {
    return mapPersistenceError(error, app.slug);
  }
  return ok(202, mutationAccepted(ctx, {
    entityId: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    desiredState: row.state,
    eventType: 'external_application.create.accepted',
  }));
}

// GET /v1/workspaces/{workspaceId}/applications/{applicationId}
export async function getExternalApplication(ctx) {
  const resolved = await resolveApplication(ctx);
  if (resolved.error) return resolved.error;
  return ok(200, resolved.application);
}

// PUT /v1/workspaces/{workspaceId}/applications/{applicationId}
export async function updateExternalApplication(ctx) {
  const resolved = await resolveApplication(ctx, { write: true });
  if (resolved.error) return resolved.error;
  const existing = resolved.application;
  const app = normalizeApplicationBody(ctx.body, { id: existing.applicationId, workspace: resolved.ws, existing });
  const validation = await validateApplicationForWrite(app, { planId: ctx.body?.planId ?? app.metadata?.planId });
  if (!validation.ok) return validationError(validation.validation.checks);
  app.validation = validation.validation;

  let row;
  try {
    row = await resolved.st.upsertExternalApplication(ctx.pool, {
      id: existing.applicationId,
      workspaceId: resolved.ws.id,
      tenantId: resolved.ws.tenant_id,
      slug: app.slug,
      protocol: app.protocol,
      state: app.state,
      appJson: app,
      actorId: ctx.identity?.sub ?? null,
    });
  } catch (error) {
    return mapPersistenceError(error, app.slug);
  }
  if (!row) return err(404, 'APPLICATION_NOT_FOUND', `application ${existing.applicationId} not found`);
  return ok(202, mutationAccepted(ctx, {
    entityId: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    desiredState: row.state,
    eventType: 'external_application.update.accepted',
  }));
}

function providersOf(application) {
  return Array.isArray(application.federatedProviders) ? application.federatedProviders : [];
}

function providerChecks(provider, { application, replacingProviderId = null } = {}) {
  const checks = [];
  if (!PROVIDER_ID_RE.test(String(provider.providerId ?? ''))) {
    checks.push(validationCheck('invalid_provider_id', 'providerId must use lowercase letters, numbers, and hyphens.', 'providerId'));
  }
  if (typeof provider.alias !== 'string' || !provider.alias.trim()) {
    checks.push(validationCheck('missing_provider_alias', 'alias is required.', 'alias'));
  }
  if (typeof provider.displayName !== 'string' || !provider.displayName.trim()) {
    checks.push(validationCheck('missing_provider_display_name', 'displayName is required.', 'displayName'));
  }
  if (!PROVIDER_PROTOCOLS.has(provider.protocol)) {
    checks.push(validationCheck('unsupported_provider_protocol', 'protocol must be oidc or saml.', 'protocol'));
  }
  if (!PROVIDER_MODES.has(provider.providerMode)) {
    checks.push(validationCheck('unsupported_provider_mode', 'providerMode must be metadata_url, inline_metadata, or manual_endpoints.', 'providerMode'));
  }
  if (application.protocol === 'api_key') {
    checks.push(validationCheck('unsupported_application_protocol', 'api_key applications do not support federated providers.', 'protocol'));
  }
  if (application.protocol === 'saml' && provider.protocol !== 'saml') {
    checks.push(validationCheck('provider_protocol_mismatch', 'SAML applications can only attach SAML providers.', 'protocol'));
  }

  const existingProviders = providersOf(application).filter((item) => item.providerId !== replacingProviderId);
  if (existingProviders.some((item) => item.providerId === provider.providerId)) {
    checks.push(validationCheck('duplicate_provider_id', `providerId ${provider.providerId} already exists.`, 'providerId'));
  }
  if (existingProviders.some((item) => item.alias === provider.alias)) {
    checks.push(validationCheck('duplicate_provider_alias', `provider alias ${provider.alias} already exists.`, 'alias'));
  }
  return checks;
}

async function persistProviders(ctx, resolved, providers, { eventType, subresourceId }) {
  const application = { ...resolved.application, federatedProviders: providers };
  const validation = await validateApplicationForWrite(application, { planId: ctx.body?.planId ?? application.metadata?.planId });
  if (!validation.ok) return validationError(validation.validation.checks);
  application.validation = validation.validation;

  const row = await resolved.st.upsertExternalApplication(ctx.pool, {
    id: application.applicationId,
    workspaceId: resolved.ws.id,
    tenantId: resolved.ws.tenant_id,
    slug: application.slug,
    protocol: application.protocol,
    state: application.state,
    appJson: application,
    actorId: ctx.identity?.sub ?? null,
  });
  return ok(202, mutationAccepted(ctx, {
    entityId: row.id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    desiredState: row.state,
    eventType,
    mutationScope: 'federated_provider',
    subresourceId,
  }));
}

// GET /v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers
export async function listExternalApplicationFederatedProviders(ctx) {
  const resolved = await resolveApplication(ctx);
  if (resolved.error) return resolved.error;
  const protocol = ctx.query?.protocol;
  const items = providersOf(resolved.application).filter((provider) => !protocol || provider.protocol === protocol);
  return ok(200, collection(items));
}

// POST /v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers
export async function createExternalApplicationFederatedProvider(ctx) {
  const resolved = await resolveApplication(ctx, { write: true });
  if (resolved.error) return resolved.error;
  const provider = { ...(ctx.body ?? {}), enabled: ctx.body?.enabled !== false };
  const checks = providerChecks(provider, { application: resolved.application });
  if (checks.length) return validationError(checks);
  const providers = [...providersOf(resolved.application), provider];
  return persistProviders(ctx, resolved, providers, {
    eventType: 'external_application.federated_provider.create.accepted',
    subresourceId: provider.providerId,
  });
}

// GET /v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers/{providerId}
export async function getExternalApplicationFederatedProvider(ctx) {
  const resolved = await resolveApplication(ctx);
  if (resolved.error) return resolved.error;
  const provider = providersOf(resolved.application).find((item) => item.providerId === ctx.params?.providerId);
  if (!provider) return err(404, 'PROVIDER_NOT_FOUND', `provider ${ctx.params?.providerId} not found`);
  return ok(200, provider);
}

// PUT /v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers/{providerId}
export async function updateExternalApplicationFederatedProvider(ctx) {
  const resolved = await resolveApplication(ctx, { write: true });
  if (resolved.error) return resolved.error;
  const providers = providersOf(resolved.application);
  const index = providers.findIndex((item) => item.providerId === ctx.params?.providerId);
  if (index < 0) return err(404, 'PROVIDER_NOT_FOUND', `provider ${ctx.params?.providerId} not found`);
  if (ctx.body?.providerId && ctx.body.providerId !== ctx.params.providerId) {
    return validationError([validationCheck('provider_id_mismatch', 'providerId cannot be changed in this route.', 'providerId')]);
  }
  const provider = { ...providers[index], ...(ctx.body ?? {}), providerId: ctx.params.providerId };
  const checks = providerChecks(provider, { application: resolved.application, replacingProviderId: ctx.params.providerId });
  if (checks.length) return validationError(checks);
  const nextProviders = [...providers];
  nextProviders[index] = provider;
  return persistProviders(ctx, resolved, nextProviders, {
    eventType: 'external_application.federated_provider.update.accepted',
    subresourceId: provider.providerId,
  });
}

export const APPLICATION_HANDLERS = {
  listExternalApplications,
  createExternalApplication,
  getExternalApplication,
  updateExternalApplication,
  listExternalApplicationStarterTemplates,
  listExternalApplicationFederatedProviders,
  createExternalApplicationFederatedProvider,
  getExternalApplicationFederatedProvider,
  updateExternalApplicationFederatedProvider,
};
