import { readGatewayPolicyValues } from '../../../scripts/lib/gateway-policy.mjs';
import { readGatewayRouting, readPublicRouteCatalog } from '../../../scripts/lib/public-api.mjs';

export function realtimeChangesFixture() {
  const values = readGatewayPolicyValues();
  const gatewayRouting = readGatewayRouting();
  const routeCatalog = readPublicRouteCatalog();
  const family = {
    ...gatewayRouting.spec.families.find(family => family.id === 'mongo-captures'),
    id: 'realtime-changes', pathPrefix: '/v1/realtime/workspaces', authMode: 'executor_verified_api_key',
  };
  gatewayRouting.spec.families = gatewayRouting.spec.families.filter(family => family.id !== 'realtime-changes');
  gatewayRouting.spec.families.push(family);
  values.gatewayPolicy.familyPolicies['realtime-changes'] = {
    tenantBinding: 'required', workspaceBinding: 'required',
    qosProfile: 'realtime', requestValidationProfile: 'realtime',
    planCapabilityAnyOf: ['data.openwhisk.actions'],
  };
  if (!routeCatalog.routes.some(route => route.family === 'realtime-changes')) {
    routeCatalog.routes.push({
      ...routeCatalog.routes.find(route => route.family === 'mongo-captures'),
      family: family.id, gatewayAuthMode: family.authMode,
    });
  }
  const route = {
    name: 'public-api-realtime-changes', uri: '/v1/realtime/workspaces/*',
    methods: ['GET', 'OPTIONS'],
    vars: [['uri', '~~', '^/v1/realtime/workspaces/[^/]+/data/[^/]+/(collections/[^/]+|schemas/[^/]+/tables/[^/]+)/changes$']],
    labels: { 'gateway.in-falcone.io/family': 'realtime-changes', 'gateway.in-falcone.io/route-kind': 'product_api' },
    plugins: {
      cors: {}, 'limit-count': { count: 120, time_window: 60, rejected_code: 429, key_type: 'var_combination', key: '$http_apikey$arg_apikey' },
      'client-control': { max_body_size: 131072 },
      'proxy-rewrite': { headers: { set: {
        'x-tenant-id': '', 'x-workspace-id': '', 'x-auth-subject': '', 'x-actor-roles': '',
        'x-gateway-auth': '${{GATEWAY_SHARED_SECRET}}',
      } } },
    },
  };
  values.bootstrap.reconcile.apisix.routes = values.bootstrap.reconcile.apisix.routes.filter(route => route.name !== 'public-api-realtime-changes');
  values.bootstrap.reconcile.apisix.routes.push(route);
  return { values, gatewayRouting, routeCatalog, route };
}
