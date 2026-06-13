/**
 * MCP OAuth 2.1 helpers (change: add-mcp-oauth-authorization-server, #390; ADR-12).
 *
 * Pure functions that model MCP authorization on the existing realm-per-tenant Keycloak
 * (see services/adapters/src/keycloak-admin.mjs and apps/control-plane/src/external-application-iam.mjs):
 *   - per-tool scopes as Keycloak client scopes (proven live: a token carried `mcp:<server>:<tool>`),
 *   - a curated client-registration request (Falcone-issued, tenant-scoped, HTTPS redirect-validated,
 *     plan-limited) — the raw Keycloak admin / DCR endpoints are never exposed to tenants.
 * No I/O here; the control-plane routes feed these into the IAM-admin adapter.
 */

export const MCP_SCOPE_PREFIX = 'mcp';

/** Sanitize a server/tool id into a scope-safe segment (lowercase, [a-z0-9-_], collapse others). */
function sanitizeSegment(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Per-tool scope name: `mcp:<server>:<tool>`. */
export function toolScopeName(serverId, toolName) {
  return `${MCP_SCOPE_PREFIX}:${sanitizeSegment(serverId)}:${sanitizeSegment(toolName)}`;
}

/**
 * Derive Keycloak client-scope definitions from a curated tool set.
 * @param {string} serverId
 * @param {Array<{name:string, description?:string}>} tools
 * @returns {Array<{name:string, protocol:string, attributes:Object}>}
 */
export function deriveToolScopes(serverId, tools = []) {
  const seen = new Set();
  const scopes = [];
  for (const tool of tools) {
    const name = toolScopeName(serverId, tool?.name);
    if (!tool?.name || seen.has(name)) continue;
    seen.add(name);
    scopes.push({
      name,
      protocol: 'openid-connect',
      attributes: {
        'include.in.token.scope': 'true',
        'display.on.consent.screen': 'true',
        'consent.screen.text': (tool.description && String(tool.description).slice(0, 200)) || `Call the ${tool.name} tool`,
      },
    });
  }
  return scopes;
}

/** An MCP redirect URI must be HTTPS (mirrors external-application-iam HTTPS validation). */
export function isHttpsRedirectUri(uri) {
  try {
    return new URL(String(uri)).protocol === 'https:';
  } catch {
    return false;
  }
}

function violation(code, message, field) {
  return { code, severity: 'error', message, field };
}

/**
 * Build a curated MCP OAuth client-registration request + any validation violations.
 * @param {Object} input
 * @param {string} input.clientId
 * @param {string[]} [input.redirectUris]
 * @param {string} input.serverId
 * @param {Array<{name:string,description?:string}>} [input.tools]
 * @param {{maxRedirectUris?:number, maxToolScopes?:number}} [input.planLimits]
 * @returns {{ request: Object|null, violations: Array<{code:string,severity:string,message:string,field:string}> }}
 */
export function buildMcpClientRegistration({ clientId, redirectUris = [], serverId, tools = [], planLimits = {} } = {}) {
  const violations = [];

  if (!clientId || !String(clientId).trim()) {
    violations.push(violation('missing_client_id', 'clientId is required.', 'clientId'));
  }
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    violations.push(violation('missing_redirect_uri', 'At least one HTTPS redirect URI is required.', 'redirectUris'));
  }
  for (const uri of redirectUris) {
    if (!isHttpsRedirectUri(uri)) {
      violations.push(violation('invalid_redirect_uri', `Redirect URI must be HTTPS: ${uri}`, 'redirectUris'));
    }
  }
  if (typeof planLimits.maxRedirectUris === 'number' && redirectUris.length > planLimits.maxRedirectUris) {
    violations.push(violation('redirect_uri_limit_exceeded', `Too many redirect URIs (max ${planLimits.maxRedirectUris}).`, 'redirectUris'));
  }

  const toolScopes = deriveToolScopes(serverId, tools);
  if (typeof planLimits.maxToolScopes === 'number' && toolScopes.length > planLimits.maxToolScopes) {
    violations.push(violation('tool_scope_limit_exceeded', `Too many tool scopes (max ${planLimits.maxToolScopes}).`, 'tools'));
  }

  if (violations.length > 0) return { request: null, violations };

  return {
    request: {
      clientId,
      protocol: 'openid-connect',
      publicClient: false,
      standardFlowEnabled: true,
      serviceAccountsEnabled: false,
      redirectUris: [...redirectUris],
      // Curated per-tool scopes attached as default client scopes; carried in the token.
      defaultClientScopes: toolScopes.map((s) => s.name),
    },
    violations: [],
  };
}

/**
 * Build the ordered IAM-admin request plan to provision an MCP OAuth client in the tenant's realm:
 * create each per-tool client scope, then register the client with those scopes as defaults.
 * Returns IAM-admin REQUEST descriptors ({ resourceKind, action, payload }) — the caller feeds each
 * to `keycloak-admin.buildIamAdminAdapterCall({ ...req, tenantId, ... })`, keeping this module free
 * of cross-package imports and consistent with the executor-over-adapter-plans pattern (ADR-4).
 *
 * @param {Object} input  same shape as buildMcpClientRegistration + { tenantId }
 * @returns {{ tenantId:string, iamRequests: Array<{resourceKind:string,action:string,payload:Object}>, violations: Array }}
 */
export function buildMcpOAuthProvisioningPlan({ tenantId, serverId, clientId, redirectUris = [], tools = [], planLimits = {} } = {}) {
  const reg = buildMcpClientRegistration({ clientId, redirectUris, serverId, tools, planLimits });
  if (reg.violations.length > 0) {
    return { tenantId, iamRequests: [], violations: reg.violations };
  }
  const toolScopes = deriveToolScopes(serverId, tools);
  const iamRequests = [
    // 1..N: per-tool client scopes (FK-safe: scopes before the client that references them).
    ...toolScopes.map((scope) => ({ resourceKind: 'scope', action: 'create', payload: scope })),
    // N+1: the curated client with the scopes attached as defaults.
    { resourceKind: 'client', action: 'create', payload: reg.request },
  ];
  return { tenantId, iamRequests, violations: [] };
}
