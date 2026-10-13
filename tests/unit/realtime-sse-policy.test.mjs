import test from 'node:test';
import assert from 'node:assert/strict';
import { collectRealtimeSseRouteViolations, REALTIME_SSE_ROUTES } from '../../scripts/lib/realtime-sse-policy.mjs';

function route(id) {
  return {
    id, name: id, authMode: 'query_api_key_sse', methods: ['GET', 'OPTIONS'],
    uri: '/v1/realtime/*', vars: [['uri', '~~', REALTIME_SSE_ROUTES[id].pattern]],
    plugins: {
      cors: {}, 'limit-count': { count: 120, time_window: 60, key_type: 'var_combination', key: '$http_apikey$arg_apikey', rejected_code: 429 },
      'client-control': { max_body_size: 1024 },
      'request-validation': { header_schema: { type: 'object', properties: { apikey: { type: 'string' } } } },
      'proxy-rewrite': { headers: { set: Object.fromEntries(['x-auth-subject', 'x-actor-username', 'x-tenant-id', 'x-workspace-id', 'x-plan-id', 'x-auth-scopes', 'x-actor-roles'].map((name) => [name, '']).concat([['x-gateway-auth', '${{GATEWAY_SHARED_SECRET}}']])) } },
    },
    accessLog: { omitQueryString: true, redactQueryParameters: ['apikey'], format: '{"path":"$uri","status":$status}' },
  };
}

test('the query_api_key_sse exception accepts only the two explicitly named routes', () => {
  for (const id of ['public-api-realtime-collection-changes', 'public-api-realtime-table-changes']) {
    assert.deepEqual(collectRealtimeSseRouteViolations(route(id)), []);
    const widened = route(id);
    widened.id = widened.name = 'public-api-mongo-captures';
    assert.ok(collectRealtimeSseRouteViolations(widened).some((message) => message.includes('not allowlisted')));
  }
});

test('SSE exceptions retain required plugins, method and path guards, header hygiene and query log redaction', () => {
  const id = 'public-api-realtime-collection-changes';
  for (const plugin of ['cors', 'limit-count', 'client-control', 'request-validation', 'proxy-rewrite']) {
    const missing = route(id);
    delete missing.plugins[plugin];
    assert.ok(collectRealtimeSseRouteViolations(missing).some((message) => message.includes(plugin)), plugin);
  }
  for (const mutate of [
    (r) => r.methods.push('HEAD'),
    (r) => r.vars[0][2] = '/changes$',
    (r) => r.plugins['proxy-rewrite'].headers.set['x-tenant-id'] = '$http_x_tenant_id',
    (r) => r.plugins['proxy-rewrite'].headers.set['x-gateway-auth'] = '',
    (r) => r.accessLog.omitQueryString = false,
    (r) => r.accessLog.format = '$request_uri',
    (r) => r.plugins['request-validation'].header_schema.required = ['apikey'],
  ]) {
    const invalid = route(id);
    mutate(invalid);
    assert.ok(collectRealtimeSseRouteViolations(invalid).length > 0);
  }
});
