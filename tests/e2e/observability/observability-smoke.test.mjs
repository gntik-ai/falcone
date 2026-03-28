import test from 'node:test';
import assert from 'node:assert/strict';

import { readYaml } from '../../../scripts/lib/quality-gates.mjs';
import {
  getAlertMaskingPolicy,
  getHealthSummaryFreshnessThreshold,
  getObservabilityCollectionHealth,
  listHealthSummaryScopes,
  listHealthSummaryStatuses,
  listObservabilityDashboardDimensions,
  listObservabilityDashboardScopes,
  listObservabilityDashboardWidgets,
  listObservabilityHealthComponents,
  listObservabilityMetricFamilies,
  listObservabilityProbeTypes,
  readObservabilityBusinessMetrics,
  readObservabilityConsoleAlerts,
  readObservabilityDashboards,
  readObservabilityHealthChecks,
  readObservabilityMetricsStack
} from '../../../services/internal-contracts/src/index.mjs';

const SMOKE_MATRIX_PATH = 'tests/reference/observability-smoke-matrix.yaml';

function listIds(items) {
  return (items ?? []).map((item) => item?.id);
}

function asSet(items) {
  return new Set(items ?? []);
}

function toSortedArray(value) {
  return Array.from(new Set(value)).sort();
}

function scenarioByFocusAndScope(matrix, focus, scope) {
  return (matrix?.smoke_scenarios ?? []).find((scenario) => scenario.focus === focus && scenario.scope === scope);
}

const smokeMatrix = readYaml(SMOKE_MATRIX_PATH);

// ---------------------------------------------------------------------------
// Contract alignment
// ---------------------------------------------------------------------------

test('observability smoke matrix anchors to the current contract versions', () => {
  const metricsStack = readObservabilityMetricsStack();
  const dashboards = readObservabilityDashboards();
  const healthChecks = readObservabilityHealthChecks();
  const businessMetrics = readObservabilityBusinessMetrics();
  const consoleAlerts = readObservabilityConsoleAlerts();

  assert.equal(smokeMatrix.version, metricsStack.version);
  assert.equal(smokeMatrix.surface_contracts.scraping.includes('metrics_stack'), true);
  assert.equal(smokeMatrix.surface_contracts.scraping.includes('health_checks'), true);
  assert.equal(smokeMatrix.surface_contracts.dashboards.includes('dashboards'), true);
  assert.equal(smokeMatrix.surface_contracts.health.includes('console_alerts'), true);

  assert.equal(dashboards.source_metrics_contract, metricsStack.version);
  assert.equal(healthChecks.source_metrics_contract, metricsStack.version);
  assert.equal(healthChecks.source_dashboard_contract, dashboards.version);
  assert.equal(businessMetrics.source_metrics_contract, metricsStack.version);
  assert.equal(businessMetrics.source_dashboard_contract, dashboards.version);
  assert.equal(businessMetrics.source_health_contract, healthChecks.version);
  assert.equal(consoleAlerts.source_metrics_contract, metricsStack.version);
  assert.equal(consoleAlerts.source_dashboard_contract, dashboards.version);
  assert.equal(consoleAlerts.source_health_contract, healthChecks.version);
  assert.equal(consoleAlerts.source_business_metrics_contract, businessMetrics.version);
});

// ---------------------------------------------------------------------------
// Shared expectations
// ---------------------------------------------------------------------------

test('shared smoke expectations match the canonical observability scopes and widgets', () => {
  const metricsStack = readObservabilityMetricsStack();
  const dashboards = readObservabilityDashboards();
  const healthChecks = readObservabilityHealthChecks();
  const healthSummaryScopes = listHealthSummaryScopes();
  const healthSummaryStatuses = listHealthSummaryStatuses();
  const dashboardScopes = listObservabilityDashboardScopes();
  const dashboardDimensions = listObservabilityDashboardDimensions();
  const dashboardWidgets = listObservabilityDashboardWidgets();
  const healthComponents = listObservabilityHealthComponents();
  const probeTypes = listObservabilityProbeTypes();
  const metricFamilies = listObservabilityMetricFamilies();
  const collectionHealth = getObservabilityCollectionHealth();
  const smoke = smokeMatrix.shared_expectations;

  assert.deepEqual(toSortedArray(smoke.required_scopes), toSortedArray(listIds(healthSummaryScopes)));
  assert.deepEqual(toSortedArray(smoke.required_dashboard_scopes), toSortedArray(listIds(dashboardScopes)));
  assert.deepEqual(toSortedArray(smoke.required_health_statuses), toSortedArray(listIds(healthSummaryStatuses)));
  assert.deepEqual(toSortedArray(smoke.required_probe_types), toSortedArray(listIds(probeTypes)));
  assert.deepEqual(toSortedArray(smoke.required_subsystems), toSortedArray(metricsStack.subsystems.map((subsystem) => subsystem.id)));
  assert.deepEqual(toSortedArray(smoke.required_dashboard_widget_ids), toSortedArray(listIds(dashboardWidgets)));
  assert.deepEqual(toSortedArray(smoke.required_dimension_ids), toSortedArray(listIds(dashboardDimensions)));
  assert.deepEqual(toSortedArray(smoke.required_metric_family_ids), toSortedArray(['component_up', 'component_operations_total', 'component_operation_errors_total', 'component_operation_duration_seconds']));
  assert.equal(smoke.required_collection_health.metric_name, collectionHealth.metric_name);
  assert.equal(smoke.required_collection_health.failure_counter, collectionHealth.failure_counter);
  assert.equal(smoke.required_collection_health.lag_metric, collectionHealth.lag_metric);
  assert.equal(smoke.freshness_threshold_seconds, getHealthSummaryFreshnessThreshold());
  assert.equal(smoke.freshness_threshold_seconds, healthChecks.status_model.stale_probe_window_seconds);
  assert.deepEqual(toSortedArray(smoke.masking_policy_forbidden_content_categories), toSortedArray(getAlertMaskingPolicy().forbidden_content_categories));

  for (const widget of dashboardWidgets) {
    assert.equal(asSet(metricsStack.subsystems.map((subsystem) => subsystem.id)).has(widget.subsystem_id), true, `widget ${widget.id} references unknown subsystem ${widget.subsystem_id}`);
  }

  assert.equal(metricFamilies.some((family) => family.id === 'component_probe_status'), true);
  assert.equal(metricFamilies.some((family) => family.id === 'component_probe_duration_seconds'), true);
  assert.equal(metricFamilies.some((family) => family.id === 'component_probe_failures_total'), true);
  assert.equal(healthComponents.length, 7);
});

// ---------------------------------------------------------------------------
// Scenario coverage
// ---------------------------------------------------------------------------

test('observability smoke scenarios cover scraping, dashboards, and health for every supported scope', () => {
  const smoke = smokeMatrix.shared_expectations;
  const scenarios = smokeMatrix.smoke_scenarios ?? [];

  const scrapingScenarios = scenarios.filter((scenario) => scenario.focus === 'scraping');
  const dashboardScenarios = scenarios.filter((scenario) => scenario.focus === 'dashboards');
  const healthScenarios = scenarios.filter((scenario) => scenario.focus === 'health');

  assert.equal(scrapingScenarios.length, 1);
  assert.equal(dashboardScenarios.length, 3);
  assert.equal(healthScenarios.length, 3);

  assert.deepEqual(toSortedArray(dashboardScenarios.map((scenario) => scenario.dashboard_scope)), toSortedArray(smoke.required_dashboard_scopes));
  assert.deepEqual(toSortedArray(healthScenarios.map((scenario) => scenario.scope)), toSortedArray(smoke.required_scopes));
  assert.equal(scrapingScenarios[0].scope, 'platform');
  assert.equal(scrapingScenarios[0].expected_dashboard_scope, 'global');
});

// ---------------------------------------------------------------------------
// Surface-specific assertions
// ---------------------------------------------------------------------------

test('scraping scenario keeps the full required subsystem roster and collection-health metrics', () => {
  const smoke = smokeMatrix.shared_expectations;
  const scenario = scenarioByFocusAndScope(smokeMatrix, 'scraping', 'platform');

  assert.ok(scenario, 'scraping smoke scenario must exist for platform scope');
  assert.deepEqual(toSortedArray(scenario.required_subsystems), toSortedArray(smoke.required_subsystems));
  assert.equal(scenario.required_collection_health.metric_name, smoke.required_collection_health.metric_name);
  assert.equal(scenario.required_collection_health.failure_counter, smoke.required_collection_health.failure_counter);
  assert.equal(scenario.required_collection_health.lag_metric, smoke.required_collection_health.lag_metric);
});

test('dashboard scenarios keep the canonical dimensions and widget roster intact', () => {
  const smoke = smokeMatrix.shared_expectations;

  for (const scope of ['platform', 'tenant', 'workspace']) {
    const scenario = scenarioByFocusAndScope(smokeMatrix, 'dashboards', scope);

    assert.ok(scenario, `dashboard smoke scenario must exist for ${scope} scope`);
    assert.equal(scenario.dashboard_scope, scope === 'platform' ? 'global' : scope);
    assert.deepEqual(toSortedArray(scenario.required_dimensions), toSortedArray(smoke.required_dimension_ids));
    assert.deepEqual(toSortedArray(scenario.required_widgets), toSortedArray(smoke.required_dashboard_widget_ids));
  }
});

test('health scenarios keep the canonical status vocabulary, freshness threshold, and probe coverage intact', () => {
  const smoke = smokeMatrix.shared_expectations;
  const healthStatusIds = toSortedArray(listHealthSummaryStatuses().map((status) => status.id));
  const componentIds = toSortedArray(listObservabilityHealthComponents().map((component) => component.id));

  for (const scope of ['platform', 'tenant', 'workspace']) {
    const scenario = scenarioByFocusAndScope(smokeMatrix, 'health', scope);

    assert.ok(scenario, `health smoke scenario must exist for ${scope} scope`);
    assert.deepEqual(toSortedArray(scenario.required_statuses), healthStatusIds);
    assert.equal(scenario.freshness_threshold_seconds, smoke.freshness_threshold_seconds);
    assert.deepEqual(toSortedArray(scenario.required_components), componentIds);
    assert.equal(asSet(scenario.probe_types ?? []).has('health'), true);

    if (scope === 'platform') {
      assert.deepEqual(toSortedArray(scenario.probe_types), ['health', 'liveness', 'readiness']);
      assert.equal(scenario.scope_isolation, 'platform_visible');
    } else {
      assert.deepEqual(toSortedArray(scenario.probe_types), ['health']);
      assert.equal(scenario.scope_isolation, 'attributed_only');
    }
  }
});

// ---------------------------------------------------------------------------
// Masking / safety boundaries
// ---------------------------------------------------------------------------

test('smoke matrix keeps the observability masking policy discoverable and scope-safe', () => {
  const smoke = smokeMatrix.shared_expectations;
  const maskingPolicy = getAlertMaskingPolicy();

  assert.deepEqual(
    toSortedArray(smoke.masking_policy_forbidden_content_categories),
    toSortedArray(maskingPolicy.forbidden_content_categories)
  );
  assert.equal(maskingPolicy.forbidden_content_categories.includes('password'), true);
  assert.equal(maskingPolicy.forbidden_content_categories.includes('raw_endpoint'), true);
  assert.equal(maskingPolicy.forbidden_content_categories.includes('object_key'), true);
});
