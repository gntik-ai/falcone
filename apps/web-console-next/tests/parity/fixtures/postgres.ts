// Synthetic inventory mirrors the legacy ConsolePostgresPage.test.tsx fields and values.
export const database = { databaseName: 'app_db', state: 'active', ownerRoleName: 'postgres_owner', placementMode: 'schema_per_tenant', tenantId: 'synthetic-tenant', workspaceId: 'synthetic-workspace' }
export const schema = { schemaName: 'public', state: 'active', ownerRoleName: 'postgres_owner', objectCounts: { tables: 1, views: 1, materializedViews: 1, indexes: 2 } }
export const table = { tableName: 'accounts', state: 'active', columnCount: 2 }
export const column = { columnName: 'id', dataType: { typeName: 'uuid' }, nullable: false, defaultExpression: 'gen_random_uuid()', ordinalPosition: 1 }
export const index = { indexName: 'accounts_pkey', indexMethod: 'btree', unique: true, keys: [{ columnName: 'id' }], includeColumns: ['email'] }
export const policy = { policyName: 'accounts_select_policy', policyMode: 'permissive', state: 'active', appliesTo: { command: 'select', roles: ['tenant_user'] }, usingExpression: "tenant_id = current_setting('app.tenant_id')" }
export const security = { rlsEnabled: true, forceRls: true, policyCount: 2, sharedTableClassification: 'tenant_scoped', state: 'review_required' }
export const view = { viewName: 'active_accounts', state: 'active', columns: ['id', 'email'], query: 'select id, email from public.accounts where active = true', securityBarrier: true }
export const matview = { viewName: 'accounts_snapshot', state: 'active', columns: ['id', 'email'], query: 'select id, email from public.accounts', withData: true, refreshPolicy: 'daily refresh', integrityProfile: { populationState: 'loaded' } }
export const ddl = {
  ddlPreview: { executionMode: 'preview', statementCount: 1, statements: [{ ordinal: 1, category: 'create', destructive: false, sql: 'CREATE TABLE public.accounts (id uuid primary key);' }], transactionMode: 'transactional_ddl', safeGuards: ['preview_only'], lockTargets: ['public.accounts'] },
  preExecutionWarnings: [{ warningCode: 'lock_risk', severity: 'high', category: 'locks', summary: 'Exclusive lock possible', impactLevel: 'high', requiresAcknowledgement: true, detail: 'The preview detects an ACCESS EXCLUSIVE lock target.' }],
  riskProfile: { riskLevel: 'high', statementCount: 1, lockTargetCount: 1, blockingLikely: true, destructive: false, acknowledgementRequired: true },
}
export const base = '/v1/postgres/databases'
export const schemas = `${base}/app_db/schemas`
export const objects = `${schemas}/public`
export const detail = `${objects}/tables/accounts`
export const query = '?page%5Bsize%5D=100'
export const paths = { databases: base, schemas, tables: `${objects}/tables`, views: `${objects}/views`, matviews: `${objects}/materialized-views`, columns: `${detail}/columns`, indexes: `${detail}/indexes`, policies: `${detail}/policies`, security: `${detail}/security` }
export const fixtures = { databases: { items: [database, { ...database, databaseName: 'analytics' }, { ...database, databaseName: 'archive' }] }, schemas: { items: [schema] }, tables: { items: [table] }, views: { items: [view] }, matviews: { items: [matview] }, columns: { items: [column] }, indexes: { items: [index] }, policies: { items: [policy] }, security }
export const quotasAvailable = { dimensions: [{ dimensionId: 'databases.count', hardLimit: 10, measuredValue: 2, policyMode: 'not_enforced' }] }
export const quotasExhausted = { dimensions: [{ dimensionId: 'databases.count', hardLimit: 10, measuredValue: 10, remainingToHardLimit: 0 }], hardLimitBreaches: ['databases.count'] }
export const tablesPage1 = { items: Array.from({ length: 100 }, (_, i) => ({ ...table, tableName: `table_${i}` })), page: { nextCursor: 'opaque/next+100' } }
export const quotaPaths = ['/v1/metrics/tenants/t-1/quotas', '/v1/metrics/tenants/t-1/overview', '/v1/metrics/workspaces/ws-1/quotas', '/v1/metrics/workspaces/ws-1/overview']
export function reads() { return Object.fromEntries(Object.entries(paths).map(([key, path]) => [`GET ${path}${key === 'security' ? '' : query}`, fixtures[key as keyof typeof fixtures]])) }
