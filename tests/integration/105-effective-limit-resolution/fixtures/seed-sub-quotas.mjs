export function seedSubQuotas(db) {
  db._workspaceSubQuotas.push({ id: 'sq-1', tenantId: 'tenant-a', workspaceId: 'ws-prod', dimensionKey: 'max_pg_databases', allocatedValue: 6, createdBy: 'seed', updatedBy: 'seed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  db._workspaceSubQuotas.push({ id: 'sq-2', tenantId: 'tenant-a', workspaceId: 'ws-prod', dimensionKey: 'max_functions', allocatedValue: 30, createdBy: 'seed', updatedBy: 'seed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  db._workspaceSubQuotas.push({ id: 'sq-3', tenantId: 'tenant-b', workspaceId: 'ws-other', dimensionKey: 'max_workspaces', allocatedValue: 2, createdBy: 'seed', updatedBy: 'seed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}
