import { resolveEffectiveLimit } from '../../packages/provisioning-orchestrator/src/repositories/quota-enforcement-repository.mjs';
import { evaluateQuotaDecision } from '../../packages/provisioning-orchestrator/src/models/quota-enforcement.mjs';

export const load = async () => ({ resolveEffectiveLimit, evaluateQuotaDecision });
export const defaults = { max_kafka_topics: 10, max_mongo_databases: 2, max_functions: 50, max_storage_bytes: 5368709120 };
export const tenantId = 'tenant-a';
export const workspace = { id: 'ws-a', tenant_id: tenantId, slug: 'app' };
export const identity = { tenantId, actorType: 'tenant_owner', sub: 'owner', roles: ['workspace_admin'], workspaceId: workspace.id };

export function governancePool({ plan = {}, overrides = {}, usage = 0, mongoNames = [], buckets = [], ownerTenant = tenantId, failLog = false } = {}) {
  const logs = [], queries = [];
  return {
    logs, queries,
    async query(sql, values) {
      queries.push({ sql, values });
      if (/FROM quota_dimension_catalog/i.test(sql)) return { rows: Object.entries(defaults).map(([dimension_key, default_value]) => ({ dimension_key, default_value, display_label: dimension_key, unit: dimension_key === 'max_storage_bytes' ? 'bytes' : 'count' })) };
      if (/FROM tenant_plan_assignments/i.test(sql)) return { rows: Object.keys(plan).length ? [{ plan_id: 'plan-a', plan_slug: 'custom', plan_status: 'active', quota_dimensions: plan }] : [] };
      if (/FROM quota_overrides/i.test(sql)) return { rows: Object.hasOwn(overrides, values[1]) ? [{ id: 'override-a', tenant_id: tenantId, dimension_key: values[1], override_value: overrides[values[1]], status: 'active', quota_type: 'hard', grace_margin: 0, expires_at: null, created_at: '2026-08-08T00:00:00Z' }] : [] };
      if (/INSERT INTO quota_enforcement_log/i.test(sql)) {
        if (failLog) throw new Error('log unavailable');
        logs.push({ tenantId: values[1], workspaceId: values[2], dimensionKey: values[3], attemptedAction: values[4], currentUsage: values[5], effectiveLimit: values[6], quotaType: values[7], graceMargin: values[8], effectiveCeiling: values[9], source: values[10], decision: values[11], actorId: values[12], correlationId: values[13] });
        return { rows: [{}] };
      }
      if (/FROM workspaces/i.test(sql)) return { rows: [{ ...workspace, tenant_id: ownerTenant }] };
      if (/SELECT DISTINCT database_name FROM workspace_mongo_databases/i.test(sql)) return { rows: mongoNames.map(database_name => ({ database_name })) };
      if (/FROM workspace_topics/i.test(sql) || /FROM fn_actions/i.test(sql)) return { rows: [{ n: usage }] };
      if (/FROM workspace_buckets/i.test(sql)) {
        if (/WHERE bucket_name/i.test(sql)) return { rows: buckets.filter(row => row.bucket_name === values[0]) };
        if (/WHERE workspace_id/i.test(sql)) return { rows: buckets.filter(row => row.workspace_id === values[0]) };
        return { rows: buckets.filter(row => row.tenant_id === values[0]) };
      }
      return { rows: [] };
    },
  };
}
