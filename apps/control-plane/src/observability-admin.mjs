import {
  getApiFamily,
  getObservabilityCollectionHealth,
  getObservabilityDashboardScope,
  getObservedSubsystem,
  listObservabilityDashboardDimensions,
  listObservabilityDashboardScopes,
  listObservabilityDashboardWidgets,
  listObservabilityMetricFamilies,
  listObservedSubsystems,
  readObservabilityDashboards,
  readObservabilityMetricsStack
} from '../../../services/internal-contracts/src/index.mjs';

export const observabilityApiFamily = getApiFamily('metrics');
export const observabilityMetricsStack = readObservabilityMetricsStack();
export const observabilityMetricFamilies = listObservabilityMetricFamilies();
export const observabilityCollectionHealth = getObservabilityCollectionHealth();
export const observabilityDashboards = readObservabilityDashboards();
export const observabilityDashboardScopes = listObservabilityDashboardScopes();
export const observabilityDashboardDimensions = listObservabilityDashboardDimensions();
export const observabilityDashboardWidgets = listObservabilityDashboardWidgets();

export function listObservabilitySubsystems() {
  return listObservedSubsystems();
}

export function getObservabilitySubsystem(subsystemId) {
  return getObservedSubsystem(subsystemId);
}

export function summarizeObservabilityPlane() {
  return {
    family: observabilityApiFamily?.id ?? 'metrics',
    version: observabilityMetricsStack.version,
    collectionModel: observabilityMetricsStack.operating_targets?.collection_model ?? 'hybrid',
    retention: observabilityMetricsStack.operating_targets?.retention ?? {},
    resolution: observabilityMetricsStack.operating_targets?.resolution ?? {},
    requiredLabels: observabilityMetricsStack.naming?.required_labels ?? [],
    metricScopeLabel: observabilityMetricsStack.naming?.metric_scope_label ?? 'metric_scope',
    collectionHealth: observabilityCollectionHealth,
    normalizedMetricFamilies: observabilityMetricFamilies.map((family) => ({
      id: family.id,
      name: family.name,
      type: family.type,
      requiredLabels: family.required_labels ?? []
    })),
    subsystems: listObservabilitySubsystems().map((subsystem) => ({
      id: subsystem.id,
      displayName: subsystem.display_name,
      collectionMode: subsystem.collection_mode,
      target: subsystem.target,
      supportedScopes: subsystem.supported_scopes,
      tenantAttributable: subsystem.tenant_attributable
    }))
  };
}

export function buildObservabilityQueryScope(input = {}) {
  const tenantLabel = observabilityMetricsStack.naming?.tenant_isolation?.tenant_label ?? 'tenant_id';
  const workspaceLabel = observabilityMetricsStack.naming?.tenant_isolation?.workspace_label ?? 'workspace_id';
  const metricScopeLabel = observabilityMetricsStack.naming?.metric_scope_label ?? 'metric_scope';
  const platformScopeValue = observabilityMetricsStack.naming?.tenant_isolation?.platform_scope_value ?? 'platform';
  const tenantScopeValue = observabilityMetricsStack.naming?.tenant_isolation?.tenant_scope_value ?? 'tenant';
  const workspaceScopeValue = observabilityMetricsStack.naming?.tenant_isolation?.workspace_scope_value ?? 'workspace';

  const labels = {};
  const filters = [];

  if (input.subsystem) {
    labels.subsystem = input.subsystem;
    filters.push(`subsystem=${input.subsystem}`);
  }

  if (input.includePlatform === true && !input.tenantId) {
    labels[metricScopeLabel] = platformScopeValue;
    filters.push(`${metricScopeLabel}=${platformScopeValue}`);
  }

  if (input.tenantId) {
    labels[tenantLabel] = input.tenantId;
    labels[metricScopeLabel] = input.workspaceId ? workspaceScopeValue : tenantScopeValue;
    filters.push(`${tenantLabel}=${input.tenantId}`);
    filters.push(`${metricScopeLabel}=${labels[metricScopeLabel]}`);
  }

  if (input.workspaceId) {
    labels[workspaceLabel] = input.workspaceId;
    filters.push(`${workspaceLabel}=${input.workspaceId}`);
  }

  return {
    labels,
    filters,
    includePlatform: input.includePlatform === true,
    platformExcludedFromTenantQueries: Boolean(input.tenantId),
    collectionHealthMetric: observabilityCollectionHealth.metric_name
  };
}


export function summarizeObservabilityDashboards() {
  return {
    version: observabilityDashboards.version,
    sourceMetricsContract: observabilityDashboards.source_metrics_contract,
    hierarchy: observabilityDashboards.hierarchy ?? {},
    dashboardScopeAliases: observabilityDashboards.scope_aliases ?? {},
    mandatoryDimensions: observabilityDashboardDimensions.map((dimension) => ({
      id: dimension.id,
      metricCategory: dimension.metric_category,
      description: dimension.description
    })),
    scopes: observabilityDashboardScopes.map((scope) => ({
      id: scope.id,
      displayName: scope.display_name,
      underlyingMetricScope: scope.underlying_metric_scope,
      level: scope.scope_hierarchy_level,
      requiredContext: scope.scope_context_requirements ?? [],
      allowedDrilldownTargets: scope.allowed_drilldown_targets ?? [],
      summaryCards: scope.summary_cards ?? [],
      mandatoryDimensions: scope.mandatory_dimensions ?? [],
      workspaceFallbackPolicy: scope.workspace_fallback_policy,
      authorization: scope.authorization ?? {}
    })),
    widgetCatalog: observabilityDashboardWidgets.map((widget) => ({
      id: widget.id,
      subsystemId: widget.subsystem_id,
      supportsDashboardScopes: widget.supports_dashboard_scopes ?? [],
      supportsMetricScopes: widget.supports_metric_scopes ?? [],
      workspaceFallback: widget.workspace_fallback
    })),
    authorizationAndTraceability: observabilityDashboards.authorization_and_traceability ?? {},
    collectionFreshness: observabilityDashboards.collection_freshness ?? {}
  };
}

export function buildObservabilityDashboardScope(input = {}) {
  const requestedDashboardScope = input.dashboardScope ?? (input.workspaceId ? 'workspace' : input.tenantId ? 'tenant' : 'global');
  const dashboardScope = getObservabilityDashboardScope(requestedDashboardScope);

  if (!dashboardScope) {
    throw new Error(`Unknown observability dashboard scope ${requestedDashboardScope}.`);
  }

  if (dashboardScope.id === 'tenant' && !input.tenantId) {
    throw new Error('tenantId is required for the tenant observability dashboard scope.');
  }

  if (dashboardScope.id === 'workspace' && (!input.tenantId || !input.workspaceId)) {
    throw new Error('tenantId and workspaceId are required for the workspace observability dashboard scope.');
  }

  const queryScope = buildObservabilityQueryScope({
    subsystem: input.subsystem,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    includePlatform: dashboardScope.id === 'global'
  });

  const widgetCatalog = observabilityDashboardWidgets
    .filter((widget) => (widget.supports_dashboard_scopes ?? []).includes(dashboardScope.id))
    .map((widget) => ({
      id: widget.id,
      subsystemId: widget.subsystem_id,
      workspaceFallback: widget.workspace_fallback,
      mandatoryDimensions: widget.mandatory_dimensions ?? [],
      inheritedWhenNarrowerScope: dashboardScope.id === 'workspace' && widget.workspace_fallback !== 'workspace_native'
    }));

  return {
    dashboardScope: dashboardScope.id,
    displayName: dashboardScope.display_name,
    underlyingMetricScope: dashboardScope.underlying_metric_scope,
    hierarchyLevel: dashboardScope.scope_hierarchy_level,
    queryScope,
    requiredContext: {
      tenantId: input.tenantId ?? null,
      workspaceId: input.workspaceId ?? null
    },
    requiredScopeContext: dashboardScope.scope_context_requirements ?? [],
    drilldownTargets: dashboardScope.allowed_drilldown_targets ?? [],
    inheritedDegradation: dashboardScope.inherited_degradation ?? {},
    workspaceFallbackPolicy: dashboardScope.workspace_fallback_policy,
    widgetCatalog,
    authorization: dashboardScope.authorization ?? {},
    traceability: dashboardScope.traceability ?? {},
    collectionFreshnessMetric: observabilityCollectionHealth.metric_name
  };
}
