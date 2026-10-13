// The executor authenticates EventSource credentials. This exception must never grow
// into a family-wide bypass of the ordinary gateway authentication policy.
export const REALTIME_SSE_AUTH_MODE = 'query_api_key_sse';
export const REALTIME_SSE_PLUGINS = ['cors', 'limit-count', 'client-control', 'request-validation', 'proxy-rewrite'];
export const SPOOFED_CONTEXT_HEADERS = ['X-Auth-Subject', 'X-Actor-Username', 'X-Tenant-Id', 'X-Workspace-Id', 'X-Plan-Id', 'X-Auth-Scopes', 'X-Actor-Roles'];
export const REALTIME_SSE_ROUTES = Object.freeze({
  'public-api-realtime-collection-changes': {
    operationId: 'streamCollectionChanges',
    path: '/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/changes',
    pattern: '^/v1/realtime/workspaces/[^/]+/data/[^/]+/collections/[^/]+/changes$',
  },
  'public-api-realtime-table-changes': {
    operationId: 'streamTableChanges',
    path: '/v1/realtime/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/changes',
    pattern: '^/v1/realtime/workspaces/[^/]+/data/[^/]+/schemas/[^/]+/tables/[^/]+/changes$',
  },
});

export function isRealtimeSseOperation(path, operation) {
  return Object.values(REALTIME_SSE_ROUTES).some((route) => route.path === path && route.operationId === operation?.operationId);
}

export function collectRealtimeSseRouteViolations(route) {
  const id = route.name ?? route.id;
  const authMode = route.authMode ?? route.labels?.['gateway.in-falcone.io/auth-mode'];
  if (authMode !== REALTIME_SSE_AUTH_MODE && !Object.hasOwn(REALTIME_SSE_ROUTES, id)) return [];
  if (!Object.hasOwn(REALTIME_SSE_ROUTES, id)) return [`SSE exception ${id} is not allowlisted.`];
  const violations = [];
  const require = (condition, message) => { if (!condition) violations.push(`SSE route ${id} ${message}.`); };
  require(authMode === REALTIME_SSE_AUTH_MODE, `must use ${REALTIME_SSE_AUTH_MODE}`);
  require(JSON.stringify(route.methods) === JSON.stringify(['GET', 'OPTIONS']), 'must allow only GET and gateway OPTIONS');
  require(JSON.stringify(route.vars) === JSON.stringify([['uri', '~~', REALTIME_SSE_ROUTES[id].pattern]]), 'must anchor its full change-stream path');
  const plugins = route.plugins ?? {};
  for (const plugin of REALTIME_SSE_PLUGINS) require(plugin in plugins, `must enable plugin ${plugin}`);
  require(!('openid-connect' in plugins) && !('issuer-jwks-auth' in plugins), 'must leave authentication to the executor');
  const schema = plugins['request-validation']?.header_schema;
  // No required custom headers: EventSource supplies the optional apikey query
  // parameter. GET-only validation is enforced by the route methods; cors terminates OPTIONS.
  require(schema?.type === 'object' && !(schema.required ?? []).length, 'request-validation must allow EventSource without required headers');
  const headers = plugins['proxy-rewrite']?.headers?.set ?? {};
  const normalized = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  for (const header of SPOOFED_CONTEXT_HEADERS) require(normalized[header.toLowerCase()] === '', `proxy-rewrite must blank ${header}`);
  require(normalized['x-gateway-auth'] === '${{GATEWAY_SHARED_SECRET}}', 'proxy-rewrite must inject the shared-secret reference');
  require(plugins['limit-count']?.rejected_code === 429 && plugins['limit-count']?.key === '$http_apikey$arg_apikey', 'limit-count must limit per key and reject with 429');
  require(plugins['client-control']?.max_body_size > 0, 'client-control must bound body size');
  require(route.accessLog?.omitQueryString === true && route.accessLog?.redactQueryParameters?.includes('apikey'), 'must redact apikey from access logging');
  require(typeof route.accessLog?.format === 'string' && route.accessLog.format.includes('$uri') && !/\$(?:request(?:_uri)?|args|arg_\w+|http_(?:apikey|x_api_key|authorization))\b/.test(route.accessLog.format), 'access logging must use the pathname without credential variables');
  return violations;
}
