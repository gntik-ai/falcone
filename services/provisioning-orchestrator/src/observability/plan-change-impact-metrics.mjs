export const plan_change_history_write_total = 'plan_change_history_write_total';
export const plan_change_history_write_duration_ms = 'plan_change_history_write_duration_ms';
export const plan_change_history_query_duration_ms = 'plan_change_history_query_duration_ms';
export const plan_change_history_over_limit_dimensions_total = 'plan_change_history_over_limit_dimensions_total';
export const plan_change_history_usage_unknown_total = 'plan_change_history_usage_unknown_total';
export const plan_change_history_event_publish_total = 'plan_change_history_event_publish_total';

export const METRIC_NAMES = {
  plan_change_history_write_total,
  plan_change_history_write_duration_ms,
  plan_change_history_query_duration_ms,
  plan_change_history_over_limit_dimensions_total,
  plan_change_history_usage_unknown_total,
  plan_change_history_event_publish_total
};

export function buildChangeImpactLogFields(entry = {}) {
  return {
    correlationId: entry.correlationId ?? null,
    tenantId: entry.tenantId ?? null,
    actorId: entry.actorId ?? null,
    historyEntryId: entry.historyEntryId ?? null,
    assignmentId: entry.planAssignmentId ?? null,
    previousPlanId: entry.previousPlanId ?? null,
    newPlanId: entry.newPlanId ?? null,
    changeDirection: entry.changeDirection ?? null,
    overLimitDimensionCount: entry.overLimitDimensionCount ?? 0,
    usageUnknownDimensionCount: Array.isArray(entry.quotaImpacts) ? entry.quotaImpacts.filter((item) => item.usageStatus === 'unknown').length : 0
  };
}

export function recordMetric(recorder, name, value = 1, tags = {}) {
  if (typeof recorder === 'function') recorder(name, value, tags);
}
