/**
 * MCP per-tenant quotas + rate limits (change: add-mcp-tenancy-isolation-quotas, #399; epic #386).
 *
 * Pure enforcement logic for the cardinal-risk dimensions of hosted MCP:
 *   - per-tenant quotas: running servers per tenant, tools per server (provision-time gates);
 *   - rate limits: tool calls/min per server AND per OAuth client (noisy-neighbor);
 *   - an enforcement decision (allow / quota-exceeded / rate-limited) with the audited response,
 *     wired to the plans/quotas capability via plan-resolved limits + an enforcement mode
 *     (`enforced` | `unbounded`, mirroring observability-quota-policies policy modes).
 *
 * Isolation: a rate-limit counter key is scoped by tenant + server (+ OAuth client), so one tenant's
 * traffic can never consume or observe another tenant's budget (ADR-2). No I/O — the gateway/control
 * plane supply the observed counts and act on the decision; this module decides and shapes the audit.
 */

/** Reference quota defaults per plan tier; the resolved plan overrides these at call time. */
export const MCP_QUOTA_DEFAULTS = {
  free: { maxServersPerTenant: 1, maxToolsPerServer: 10, toolCallsPerMinutePerServer: 60, toolCallsPerMinutePerOAuthClient: 30, mode: 'enforced' },
  standard: { maxServersPerTenant: 10, maxToolsPerServer: 50, toolCallsPerMinutePerServer: 600, toolCallsPerMinutePerOAuthClient: 300, mode: 'enforced' },
  enterprise: { maxServersPerTenant: 100, maxToolsPerServer: 200, toolCallsPerMinutePerServer: 6000, toolCallsPerMinutePerOAuthClient: 3000, mode: 'enforced' },
};

const ENFORCEMENT_MODES = new Set(['enforced', 'unbounded']);

function allow(dimension, limit, observed) {
  return { allowed: true, dimension, limit, observed };
}

function denyQuota(dimension, limit, observed) {
  return {
    allowed: false,
    dimension,
    code: 'QUOTA_EXCEEDED',
    httpStatus: 429,
    limit,
    observed,
    message: `MCP ${dimension} quota exceeded (limit ${limit}).`,
  };
}

function denyRate(dimension, limit, observed, windowSeconds) {
  return {
    allowed: false,
    dimension,
    code: 'RATE_LIMITED',
    httpStatus: 429,
    limit,
    observed,
    retryAfterSeconds: windowSeconds,
    message: `MCP ${dimension} rate limit exceeded (${limit} per ${windowSeconds}s).`,
  };
}

function resolveMode(plan = {}) {
  const mode = plan.mode ?? 'enforced';
  if (!ENFORCEMENT_MODES.has(mode)) throw new Error(`Unknown MCP enforcement mode "${mode}".`);
  return mode;
}

/** Gate provisioning a new server against the per-tenant running-server quota. */
export function evaluateServerCountQuota({ plan = {}, currentServers = 0 } = {}) {
  const limit = plan.maxServersPerTenant;
  if (resolveMode(plan) === 'unbounded' || limit == null) return allow('servers_per_tenant', limit ?? null, currentServers);
  // currentServers is the count BEFORE adding the new one; provisioning is allowed while < limit.
  return currentServers >= limit ? denyQuota('servers_per_tenant', limit, currentServers) : allow('servers_per_tenant', limit, currentServers);
}

/** Gate a server's curated tool count against the per-server tool quota. */
export function evaluateToolCountQuota({ plan = {}, toolCount = 0 } = {}) {
  const limit = plan.maxToolsPerServer;
  if (resolveMode(plan) === 'unbounded' || limit == null) return allow('tools_per_server', limit ?? null, toolCount);
  return toolCount > limit ? denyQuota('tools_per_server', limit, toolCount) : allow('tools_per_server', limit, toolCount);
}

/**
 * Rate-limit a tool call within the current window. `scope` selects which budget to check.
 * @param {{plan:object, scope:'server'|'oauth_client', windowCount:number, windowSeconds?:number}} input
 */
export function evaluateToolCallRate({ plan = {}, scope, windowCount = 0, windowSeconds = 60 } = {}) {
  const dimension = scope === 'oauth_client' ? 'tool_calls_per_oauth_client' : 'tool_calls_per_server';
  const limit = scope === 'oauth_client' ? plan.toolCallsPerMinutePerOAuthClient : plan.toolCallsPerMinutePerServer;
  if (resolveMode(plan) === 'unbounded' || limit == null) return allow(dimension, limit ?? null, windowCount);
  // windowCount is the count INCLUDING the current call; blocked when it would exceed the limit.
  return windowCount > limit ? denyRate(dimension, limit, windowCount, windowSeconds) : allow(dimension, limit, windowCount);
}

/**
 * Tenant/server/client-scoped rate-limit counter key. Always prefixed by tenant + server so one
 * tenant's traffic can never share or observe another tenant's budget.
 */
export function rateLimitKey({ tenantId, serverId, oauthClientId, scope } = {}) {
  if (!tenantId) throw new Error('rateLimitKey requires a tenant id (isolation).');
  if (!serverId) throw new Error('rateLimitKey requires a server id.');
  const base = `mcp:rl:${tenantId}:${serverId}`;
  return scope === 'oauth_client' ? `${base}:oac:${oauthClientId ?? 'unknown'}` : `${base}:server`;
}

/**
 * Build the audit event for a denied quota/rate-limit decision (subsystem `mcp`).
 * Conforms to the audit-event-schema shape used by mcp-observability.mjs.
 * @param {object} decision  a deny decision from an evaluate* function
 * @param {{tenantId:string, workspaceId?:string, serverId?:string, oauthClientId?:string,
 *          correlationId:string, eventId:string, eventTimestamp:string}} ctx
 */
export function quotaEnforcementAudit(decision, ctx = {}) {
  if (!ctx.tenantId) throw new Error('Quota enforcement audit requires a tenant scope (ADR-2).');
  const mode = ctx.workspaceId ? 'tenant_workspace' : 'tenant';
  const scope = { mode, tenant_id: ctx.tenantId };
  if (ctx.workspaceId) scope.workspace_id = ctx.workspaceId;
  const resource = { subsystem: 'mcp', resource_type: 'mcp_quota', resource_id: decision.dimension };
  if (ctx.serverId) resource.mcp_server_id = ctx.serverId;
  return {
    event_id: ctx.eventId,
    event_timestamp: ctx.eventTimestamp,
    actor: { actor_id: ctx.oauthClientId ?? 'system', actor_type: ctx.oauthClientId ? 'oauth_client' : 'system' },
    scope,
    resource,
    action: { category: 'quota_adjustment', id: `mcp.quota.${decision.code === 'RATE_LIMITED' ? 'rate_limited' : 'quota_exceeded'}` },
    result: { outcome: 'denied' },
    correlation_id: ctx.correlationId,
    origin: { origin_surface: 'control_api', emitting_service: 'control-plane' },
    detail: { dimension: decision.dimension, limit: decision.limit, observed: decision.observed },
  };
}
