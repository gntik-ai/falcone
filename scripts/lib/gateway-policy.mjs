import { readDeploymentTopology, resolveValues } from './deployment-topology.mjs';
import { readDomainModel } from './domain-model.mjs';
import { readGatewayRouting, readPublicRouteCatalog } from './public-api.mjs';
import { readYaml } from './quality-gates.mjs';

export const ROOT_VALUES_PATH = 'charts/in-atelier/values.yaml';
export const ENVIRONMENTS = ['dev', 'sandbox', 'staging', 'prod'];
export const PASSTHROUGH_MODES = ['enabled', 'limited', 'disabled'];
export const REQUIRED_PROPAGATED_HEADER_KEYS = ['subject', 'username', 'tenantId', 'workspaceId', 'planId', 'scopes', 'roles'];
export const REQUIRED_PRODUCT_PLUGINS = ['openid-connect', 'cors', 'request-validation', 'proxy-rewrite'];
export const REQUIRED_PASSTHROUGH_PLUGINS = ['openid-connect', 'cors', 'request-validation', 'proxy-rewrite', 'authz-keycloak', 'http-logger'];
export const REQUIRED_PERSONAS = ['basic_profile', 'tenant_admin', 'superadmin'];
export const CORE_ROUTE_NAMES = ['control-plane', 'identity', 'realtime', 'console', 'health'];

export function readGatewayPolicyValues(path = ROOT_VALUES_PATH) {
  return readYaml(path);
}

export function listEnabledApisixRoutes(values = readGatewayPolicyValues()) {
  const mode = values?.gatewayPolicy?.passthrough?.mode;
  return (values?.bootstrap?.reconcile?.apisix?.routes ?? []).filter(
    (route) => !Array.isArray(route?.enabledInModes) || route.enabledInModes.includes(mode)
  );
}

export function listPublicApiRoutes(values = readGatewayPolicyValues()) {
  return listEnabledApisixRoutes(values).filter((route) => route?.labels?.['gateway.in-atelier.io/route-kind'] === 'product_api');
}

export function listPassthroughRoutes(values = readGatewayPolicyValues()) {
  return listEnabledApisixRoutes(values).filter((route) => route?.labels?.['gateway.in-atelier.io/route-kind'] === 'passthrough');
}

export function resolvePlanCapabilities(planId, domainModel = readDomainModel()) {
  const plan = (domainModel?.governance_catalogs?.plans ?? []).find((entry) => entry.planId === planId);
  return new Set(plan?.capabilityKeys ?? []);
}

function routeCatalogByFamily(routeCatalog) {
  return new Map(
    (routeCatalog?.routes ?? []).reduce((acc, route) => {
      if (!route?.family) return acc;
      const bucket = acc.get(route.family) ?? [];
      bucket.push(route);
      acc.set(route.family, bucket);
      return acc;
    }, new Map())
  );
}

function findPersona(values, personaId) {
  return (values?.gatewayPolicy?.accessMatrix?.personas ?? []).find((persona) => persona.id === personaId);
}

function findPassthroughPolicy(values, routeId) {
  return (values?.gatewayPolicy?.passthrough?.routes ?? []).find((route) => route.id === routeId);
}

export function evaluateAccessAssertion(assertion, values = readGatewayPolicyValues(), routeCatalog = readPublicRouteCatalog(), domainModel = readDomainModel()) {
  const persona = findPersona(values, assertion?.persona);
  if (!persona) {
    return { decision: 'deny', reason: `unknown_persona:${String(assertion?.persona)}` };
  }

  if (assertion?.routeKind === 'passthrough') {
    const route = findPassthroughPolicy(values, assertion.routeId);
    if (!route) {
      return { decision: 'deny', reason: `unknown_passthrough:${String(assertion?.routeId)}` };
    }

    const mode = values?.gatewayPolicy?.passthrough?.mode;
    const enabled = (route.enabledInModes ?? []).includes(mode);
    if (!enabled) {
      return { decision: 'deny', reason: `passthrough_mode:${String(mode)}` };
    }

    const hasRoles = (route.requiredRoles ?? []).every((role) => (persona.roles ?? []).includes(role));
    const hasScopes = (route.requiredScopes ?? []).every((scope) => (persona.scopes ?? []).includes(scope));
    return { decision: hasRoles && hasScopes ? 'allow' : 'deny', reason: hasRoles && hasScopes ? 'passthrough_granted' : 'passthrough_policy' };
  }

  if (assertion?.routeKind === 'product_api') {
    const family = assertion.family;
    const familyRoutes = routeCatalogByFamily(routeCatalog).get(family) ?? [];
    if (familyRoutes.length === 0) {
      return { decision: 'deny', reason: `unknown_family:${String(family)}` };
    }

    const familyPolicy = values?.gatewayPolicy?.familyPolicies?.[family] ?? {};
    const planCapabilities = resolvePlanCapabilities(persona.planId, domainModel);
    const planCapabilityAnyOf = familyPolicy.planCapabilityAnyOf ?? [];
    const planSatisfied = planCapabilityAnyOf.length === 0 || planCapabilityAnyOf.some((capability) => planCapabilities.has(capability));
    const audienceSatisfied = familyRoutes.some((route) => (route.audiences ?? []).some((audience) => (persona.audiences ?? []).includes(audience)));

    return {
      decision: audienceSatisfied && planSatisfied ? 'allow' : 'deny',
      reason: audienceSatisfied && planSatisfied ? 'family_policy' : !audienceSatisfied ? 'audience_policy' : 'plan_policy'
    };
  }

  return { decision: 'deny', reason: `unknown_route_kind:${String(assertion?.routeKind)}` };
}

function collectOidcViolations(values, violations) {
  const oidc = values?.gatewayPolicy?.oidc ?? {};
  if (!oidc.enabled) {
    violations.push('gatewayPolicy.oidc.enabled must remain true.');
  }
  for (const field of ['issuerUrl', 'discoveryUrl', 'clientId', 'realm']) {
    if (typeof oidc?.[field] !== 'string' || oidc[field].length === 0) {
      violations.push(`gatewayPolicy.oidc.${field} must be a non-empty string.`);
    }
  }
  if (!String(oidc.discoveryUrl ?? '').startsWith(String(oidc.issuerUrl ?? ''))) {
    violations.push('gatewayPolicy.oidc.discoveryUrl must be rooted under gatewayPolicy.oidc.issuerUrl.');
  }
}

function collectClaimsViolations(values, violations) {
  const claims = values?.gatewayPolicy?.claimsPropagation ?? {};
  if (!claims.stripIncomingHeaders) {
    violations.push('gatewayPolicy.claimsPropagation.stripIncomingHeaders must remain true.');
  }

  for (const key of REQUIRED_PROPAGATED_HEADER_KEYS) {
    if (!claims?.trustedClaimMappings?.[key]) {
      violations.push(`gatewayPolicy.claimsPropagation.trustedClaimMappings.${key} must be defined.`);
    }
    if (!claims?.headers?.[key]) {
      violations.push(`gatewayPolicy.claimsPropagation.headers.${key} must be defined.`);
    }
  }

  const requiredHeaders = claims.requiredRequestHeaders ?? [];
  for (const header of ['X-API-Version', 'X-Correlation-Id']) {
    if (!requiredHeaders.includes(header)) {
      violations.push(`gatewayPolicy.claimsPropagation.requiredRequestHeaders must include ${header}.`);
    }
  }
}

function collectCorsViolations(values, violations) {
  const cors = values?.gatewayPolicy?.cors ?? {};
  for (const field of ['allowOrigins', 'allowMethods', 'allowHeaders', 'exposeHeaders']) {
    if (!Array.isArray(cors?.[field]) || cors[field].length === 0) {
      violations.push(`gatewayPolicy.cors.${field} must be a non-empty array.`);
    }
  }

  for (const header of ['Authorization', 'X-API-Version', 'X-Correlation-Id', 'Idempotency-Key']) {
    if (!(cors.allowHeaders ?? []).includes(header)) {
      violations.push(`gatewayPolicy.cors.allowHeaders must include ${header}.`);
    }
  }

  if (!(cors.allowMethods ?? []).includes('OPTIONS')) {
    violations.push('gatewayPolicy.cors.allowMethods must include OPTIONS for browser preflights.');
  }
}

function collectRoutingAlignmentViolations(values, gatewayRouting, routeCatalog, violations) {
  const familyPolicies = values?.gatewayPolicy?.familyPolicies ?? {};
  const routingFamilies = gatewayRouting?.spec?.families ?? [];
  const routingById = new Map(routingFamilies.map((family) => [family.id, family]));
  const catalogFamilies = new Set((routeCatalog?.routes ?? []).map((route) => route.family));
  const propagatedHeaders = Object.values(values?.gatewayPolicy?.claimsPropagation?.headers ?? {}).sort();

  for (const [familyId, policy] of Object.entries(familyPolicies)) {
    const routing = routingById.get(familyId);
    if (!routing) {
      violations.push(`services/gateway-config/base/public-api-routing.yaml must define family ${familyId}.`);
      continue;
    }

    if (!catalogFamilies.has(familyId)) {
      violations.push(`public-route-catalog must include family ${familyId}.`);
    }

    if (routing.corsProfile !== 'product_api') {
      violations.push(`Gateway routing family ${familyId} must use corsProfile product_api.`);
    }
    if (routing.allowAnonymousOptions !== true) {
      violations.push(`Gateway routing family ${familyId} must allow anonymous OPTIONS preflights.`);
    }
    if (routing.tenantBinding !== policy.tenantBinding) {
      violations.push(`Gateway routing family ${familyId} must keep tenantBinding=${policy.tenantBinding}.`);
    }
    if (routing.workspaceBinding !== policy.workspaceBinding) {
      violations.push(`Gateway routing family ${familyId} must keep workspaceBinding=${policy.workspaceBinding}.`);
    }

    if (JSON.stringify((routing.propagatedHeaders ?? []).slice().sort()) !== JSON.stringify(propagatedHeaders)) {
      violations.push(`Gateway routing family ${familyId} must propagate the approved auth context headers.`);
    }

    if (JSON.stringify(routing.planCapabilityAnyOf ?? []) !== JSON.stringify(policy.planCapabilityAnyOf ?? [])) {
      violations.push(`Gateway routing family ${familyId} must preserve planCapabilityAnyOf from gatewayPolicy.familyPolicies.`);
    }
  }

  for (const route of routeCatalog?.routes ?? []) {
    const routing = routingById.get(route.family);
    if (!routing) continue;

    if (route.gatewayAuthMode !== routing.authMode) {
      violations.push(`Route catalog entry ${route.operationId} must expose gatewayAuthMode ${routing.authMode}.`);
    }
    if (route.gatewayRouteClass !== routing.routeClass) {
      violations.push(`Route catalog entry ${route.operationId} must expose gatewayRouteClass ${routing.routeClass}.`);
    }
    if (JSON.stringify(route.gatewayContextHeaders ?? []) !== JSON.stringify(routing.propagatedHeaders ?? [])) {
      violations.push(`Route catalog entry ${route.operationId} must preserve gatewayContextHeaders.`);
    }
  }
}

function collectApisixRouteViolations(values, gatewayRouting, violations) {
  const enabledRoutes = listEnabledApisixRoutes(values);
  const enabledNames = new Set(enabledRoutes.map((route) => route.name));
  const routingFamilies = gatewayRouting?.spec?.families ?? [];

  for (const routeName of CORE_ROUTE_NAMES) {
    if (!enabledNames.has(routeName)) {
      violations.push(`Enabled APISIX route inventory must include ${routeName}.`);
    }
  }

  for (const family of routingFamilies) {
    const route = enabledRoutes.find((entry) => entry.name === `public-api-${family.id}`);
    if (!route) {
      violations.push(`Enabled APISIX route inventory must include public-api-${family.id}.`);
      continue;
    }

    for (const plugin of REQUIRED_PRODUCT_PLUGINS) {
      if (!(plugin in (route.plugins ?? {}))) {
        violations.push(`APISIX route public-api-${family.id} must enable plugin ${plugin}.`);
      }
    }

    if (route.labels?.['gateway.in-atelier.io/family'] !== family.id) {
      violations.push(`APISIX route public-api-${family.id} must carry the family label.`);
    }
  }

  const passthroughPolicyRoutes = values?.gatewayPolicy?.passthrough?.routes ?? [];
  for (const policyRoute of passthroughPolicyRoutes) {
    const enabled = (policyRoute.enabledInModes ?? []).includes(values?.gatewayPolicy?.passthrough?.mode);
    const apisixRoute = enabledRoutes.find(
      (route) => route.labels?.['gateway.in-atelier.io/passthrough-id'] === policyRoute.id
    );

    if (enabled && !apisixRoute) {
      violations.push(`Enabled passthrough route ${policyRoute.id} must be present in APISIX reconciliation values.`);
      continue;
    }

    if (!enabled && apisixRoute) {
      violations.push(`Disabled passthrough route ${policyRoute.id} must not be present in APISIX reconciliation values.`);
    }

    if (!apisixRoute) continue;

    for (const plugin of REQUIRED_PASSTHROUGH_PLUGINS) {
      if (!(plugin in (apisixRoute.plugins ?? {}))) {
        violations.push(`Passthrough APISIX route ${policyRoute.id} must enable plugin ${plugin}.`);
      }
    }
  }
}

function collectAccessMatrixViolations(values, routeCatalog, domainModel, violations) {
  const personas = values?.gatewayPolicy?.accessMatrix?.personas ?? [];
  const assertions = values?.gatewayPolicy?.accessMatrix?.assertions ?? [];

  for (const personaId of REQUIRED_PERSONAS) {
    if (!personas.some((persona) => persona.id === personaId)) {
      violations.push(`gatewayPolicy.accessMatrix.personas must include ${personaId}.`);
    }
  }

  for (const assertion of assertions) {
    const result = evaluateAccessAssertion(assertion, values, routeCatalog, domainModel);
    if (result.decision !== assertion.expect) {
      violations.push(
        `Access assertion ${assertion.persona}/${assertion.routeKind}/${assertion.family ?? assertion.routeId} expected ${assertion.expect} but evaluated ${result.decision} (${result.reason}).`
      );
    }
  }
}

function collectEnvironmentViolations(violations) {
  const topology = readDeploymentTopology();

  for (const environmentId of ENVIRONMENTS) {
    const values = resolveValues(environmentId, 'kubernetes');
    const expectedIdentityHost = values?.publicSurface?.hostnames?.identity;
    const expectedConsoleHost = values?.publicSurface?.hostnames?.console;
    const passthroughMode = values?.gatewayPolicy?.passthrough?.mode;
    const topologyProfile = (topology?.environment_profiles ?? []).find((entry) => entry.id === environmentId);
    const topologyMode = topologyProfile?.operational_profile?.passthrough_mode;

    if (passthroughMode !== topologyMode) {
      violations.push(`Resolved ${environmentId} values must align gatewayPolicy.passthrough.mode=${topologyMode}.`);
    }

    if (!String(values?.gatewayPolicy?.oidc?.issuerUrl ?? '').includes(expectedIdentityHost)) {
      violations.push(`Resolved ${environmentId} values must point gatewayPolicy.oidc.issuerUrl at ${expectedIdentityHost}.`);
    }

    if (JSON.stringify(values?.gatewayPolicy?.cors?.allowOrigins ?? []) !== JSON.stringify([`https://${expectedConsoleHost}`])) {
      violations.push(`Resolved ${environmentId} values must scope CORS allowOrigins to https://${expectedConsoleHost}.`);
    }
  }
}

export function collectGatewayPolicyViolations({
  values = readGatewayPolicyValues(),
  gatewayRouting = readGatewayRouting(),
  routeCatalog = readPublicRouteCatalog(),
  domainModel = readDomainModel()
} = {}) {
  const violations = [];

  collectOidcViolations(values, violations);
  collectClaimsViolations(values, violations);
  collectCorsViolations(values, violations);
  collectRoutingAlignmentViolations(values, gatewayRouting, routeCatalog, violations);
  collectApisixRouteViolations(values, gatewayRouting, violations);
  collectAccessMatrixViolations(values, routeCatalog, domainModel, violations);
  collectEnvironmentViolations(violations);

  return violations;
}
