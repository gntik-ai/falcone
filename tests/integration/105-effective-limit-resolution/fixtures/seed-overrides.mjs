export function seedOverrides(db) {
  db._quotaOverrides.push({ id: 'ov-1', tenantId: 'acme-corp', dimensionKey: 'max_workspaces', overrideValue: 8, quotaType: 'hard', graceMargin: 0, status: 'active' });
  db._quotaOverrides.push({ id: 'ov-2', tenantId: 'acme-corp', dimensionKey: 'max_pg_databases', overrideValue: 0, quotaType: 'hard', graceMargin: 0, status: 'active' });
  db._quotaOverrides.push({ id: 'ov-3', tenantId: 'tenant-a', dimensionKey: 'max_workspaces', overrideValue: 3, quotaType: 'hard', graceMargin: 0, status: 'active' });
}
