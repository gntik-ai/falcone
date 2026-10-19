const key = 'codewiki_max_projects';
export function quotaPool({ plan = {}, types = {}, failure, workspaceTenant = 'tenant-a', missingWorkspace = false, failLog = false } = {}) {
  const logs = [];
  return { logs, async query(sql, values) {
    if (/FROM workspaces/i.test(sql)) return { rows: missingWorkspace ? [] : [{ id: values[0], tenant_id: workspaceTenant }] };
    if (/INSERT INTO quota_enforcement_log/i.test(sql)) {
      if (failLog) throw new Error('audit unavailable');
      logs.push(values);
      return { rows: [{}] };
    }
    if (failure && sql.includes(failure)) throw new Error('governance unavailable');
    if (/FROM quota_dimension_catalog/i.test(sql)) return { rows: [
      { dimension_key: key, display_label: 'Projects', unit: 'count', default_value: 3 },
      { dimension_key: 'codewiki_max_repository_bytes', display_label: 'Snapshot bytes', unit: 'bytes', default_value: 524288000 },
      { dimension_key: 'max_workspaces', display_label: 'Workspaces', unit: 'count', default_value: 3 },
    ] };
    if (/FROM tenant_plan_assignments/i.test(sql)) return { rows: [{ plan_id: 'plan-a', plan_slug: 'custom', plan_status: 'active', quota_dimensions: plan, quota_type_config: types }] };
    if (/FROM quota_overrides/i.test(sql)) return { rows: [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
}
