import { readJson } from './quality-gates.mjs';

export const OBSERVABILITY_DASHBOARDS_PATH = 'services/internal-contracts/src/observability-dashboards.json';
export const OBSERVABILITY_METRICS_STACK_PATH = 'services/internal-contracts/src/observability-metrics-stack.json';
export const ARCHITECTURE_README_PATH = 'docs/reference/architecture/README.md';
export const ARCHITECTURE_DASHBOARDS_DOC_PATH = 'docs/reference/architecture/observability-health-dashboards.md';
export const OBS_TASK_DOC_PATH = 'docs/tasks/us-obs-01.md';
export const PACKAGE_JSON_PATH = 'package.json';

const REQUIRED_DASHBOARD_SCOPE_IDS = ['global', 'tenant', 'workspace'];
const REQUIRED_DIMENSION_IDS = ['availability', 'errors', 'latency', 'throughput', 'collection_freshness'];
const REQUIRED_AUDIT_FIELDS = ['actor_id', 'dashboard_scope', 'correlation_id'];
const REQUIRED_WIDGET_FALLBACKS = new Set(['tenant_inherited', 'workspace_native']);

export function readObservabilityDashboards() {
  return readJson(OBSERVABILITY_DASHBOARDS_PATH);
}

export function readObservabilityMetricsStack() {
  return readJson(OBSERVABILITY_METRICS_STACK_PATH);
}

export function readPackageJson() {
  return readJson(PACKAGE_JSON_PATH);
}

function indexBy(items = [], keyField = 'id') {
  return new Map(items.map((item) => [item?.[keyField], item]));
}

export function collectObservabilityDashboardViolations(
  dashboards = readObservabilityDashboards(),
  metricsStack = readObservabilityMetricsStack(),
  packageJson = readPackageJson()
) {
  const violations = [];

  if (typeof dashboards?.version !== 'string' || dashboards.version.length === 0) {
    violations.push('Observability dashboards contract version must be a non-empty string.');
  }

  if (dashboards?.source_metrics_contract !== metricsStack?.version) {
    violations.push('Observability dashboards source_metrics_contract must align with observability-metrics-stack.json version.');
  }

  const metricsScopeLabel = metricsStack?.naming?.metric_scope_label ?? 'metric_scope';
  if (metricsScopeLabel !== 'metric_scope') {
    violations.push('Observability dashboards validation expects observability metrics scope label metric_scope.');
  }

  const subsystemIds = new Set((metricsStack?.subsystems ?? []).map((subsystem) => subsystem.id));
  const metricsScopes = new Set([
    metricsStack?.naming?.tenant_isolation?.platform_scope_value ?? 'platform',
    metricsStack?.naming?.tenant_isolation?.tenant_scope_value ?? 'tenant',
    metricsStack?.naming?.tenant_isolation?.workspace_scope_value ?? 'workspace'
  ]);

  const dimensionMap = indexBy(dashboards?.mandatory_health_dimensions ?? []);
  for (const dimensionId of REQUIRED_DIMENSION_IDS) {
    if (!dimensionMap.has(dimensionId)) {
      violations.push(`Observability dashboards must define mandatory health dimension ${dimensionId}.`);
    }
  }

  const scopeAliasEntries = Object.entries(dashboards?.scope_aliases ?? {});
  if (scopeAliasEntries.length !== REQUIRED_DASHBOARD_SCOPE_IDS.length) {
    violations.push('Observability dashboards must define scope aliases for global, tenant, and workspace.');
  }

  for (const scopeId of REQUIRED_DASHBOARD_SCOPE_IDS) {
    const alias = dashboards?.scope_aliases?.[scopeId];
    if (!alias) {
      violations.push(`Observability dashboards must define scope alias for ${scopeId}.`);
      continue;
    }

    if (alias.dashboard_scope !== scopeId) {
      violations.push(`Observability dashboards scope alias ${scopeId} must echo dashboard_scope=${scopeId}.`);
    }

    if (!metricsScopes.has(alias.metric_scope)) {
      violations.push(`Observability dashboards scope alias ${scopeId} must map to a known metric scope.`);
    }
  }

  const widgetMap = indexBy(dashboards?.subsystem_widget_catalog ?? []);
  for (const widget of dashboards?.subsystem_widget_catalog ?? []) {
    if (!subsystemIds.has(widget.subsystem_id)) {
      violations.push(`Observability dashboard widget ${widget.id} references unknown subsystem ${widget.subsystem_id}.`);
    }

    for (const scopeId of widget.supports_dashboard_scopes ?? []) {
      if (!REQUIRED_DASHBOARD_SCOPE_IDS.includes(scopeId)) {
        violations.push(`Observability dashboard widget ${widget.id} references unknown dashboard scope ${scopeId}.`);
      }
    }

    for (const metricScope of widget.supports_metric_scopes ?? []) {
      if (!metricsScopes.has(metricScope)) {
        violations.push(`Observability dashboard widget ${widget.id} references unknown metric scope ${metricScope}.`);
      }
    }

    if (!REQUIRED_WIDGET_FALLBACKS.has(widget.workspace_fallback)) {
      violations.push(`Observability dashboard widget ${widget.id} must define a supported workspace_fallback.`);
    }

    for (const dimensionId of REQUIRED_DIMENSION_IDS) {
      if (!(widget.mandatory_dimensions ?? []).includes(dimensionId)) {
        violations.push(`Observability dashboard widget ${widget.id} must include mandatory dimension ${dimensionId}.`);
      }
    }
  }

  const scopes = dashboards?.dashboard_scopes ?? [];
  const scopeMap = indexBy(scopes);
  for (const [index, scopeId] of REQUIRED_DASHBOARD_SCOPE_IDS.entries()) {
    const scope = scopeMap.get(scopeId);
    if (!scope) {
      violations.push(`Observability dashboards must define scope ${scopeId}.`);
      continue;
    }

    if (scope.scope_hierarchy_level !== index) {
      violations.push(`Observability dashboard scope ${scopeId} must use hierarchy level ${index}.`);
    }

    if (scope.underlying_metric_scope !== dashboards?.scope_aliases?.[scopeId]?.metric_scope) {
      violations.push(`Observability dashboard scope ${scopeId} must align underlying_metric_scope with scope_aliases.`);
    }

    for (const dimensionId of REQUIRED_DIMENSION_IDS) {
      if (!(scope.mandatory_dimensions ?? []).includes(dimensionId)) {
        violations.push(`Observability dashboard scope ${scopeId} must include mandatory dimension ${dimensionId}.`);
      }
    }

    for (const widgetId of scope.widget_ids ?? []) {
      const widget = widgetMap.get(widgetId);
      if (!widget) {
        violations.push(`Observability dashboard scope ${scopeId} references unknown widget ${widgetId}.`);
        continue;
      }

      if (!(widget.supports_dashboard_scopes ?? []).includes(scopeId)) {
        violations.push(`Observability dashboard scope ${scopeId} references widget ${widgetId} without matching scope support.`);
      }
    }

    for (const field of REQUIRED_AUDIT_FIELDS) {
      if (!(scope.traceability?.must_capture ?? []).includes(field)) {
        violations.push(`Observability dashboard scope ${scopeId} must capture traceability field ${field}.`);
      }
    }
  }

  const drilldownRules = dashboards?.hierarchy?.drilldown_rules ?? [];
  if (drilldownRules.length < 2) {
    violations.push('Observability dashboards hierarchy must define global→tenant and tenant→workspace drilldown rules.');
  }

  for (const transition of drilldownRules) {
    if (!scopeMap.has(transition.from) || !scopeMap.has(transition.to)) {
      violations.push(`Observability dashboards drilldown rule ${transition.from}→${transition.to} must reference known scopes.`);
    }
  }

  const allowedStates = new Set(dashboards?.health_states?.allowed_values ?? []);
  for (const state of ['healthy', 'degraded', 'unknown', 'stale', 'inherited']) {
    if (!allowedStates.has(state)) {
      violations.push(`Observability dashboards health states must include ${state}.`);
    }
  }

  if (dashboards?.collection_freshness?.telemetry_contract?.health_metric !== metricsStack?.collection_health?.metric_name) {
    violations.push('Observability dashboards collection_freshness.health_metric must align with observability metrics stack collection health metric.');
  }

  if (!packageJson?.scripts?.['validate:observability-dashboards']) {
    violations.push('package.json must define script validate:observability-dashboards.');
  }

  const validateRepoScript = packageJson?.scripts?.['validate:repo'] ?? '';
  if (!validateRepoScript.includes('validate:observability-dashboards')) {
    violations.push('package.json validate:repo must include validate:observability-dashboards.');
  }

  return violations;
}
