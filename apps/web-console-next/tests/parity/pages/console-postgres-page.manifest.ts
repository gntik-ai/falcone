// Fixtures ported field for field from the legacy ConsolePostgresPage tests.
export function dbFixture(overrides: Partial<ReturnType<typeof dbFixtureBase>> = {}) {
  return { ...dbFixtureBase(), ...overrides }
}

export function dbFixtureBase() {
  return {
    databaseName: 'app_db',
    state: 'active',
    ownerRoleName: 'postgres_owner',
    placementMode: 'schema_per_tenant',
    tenantId: 'ten_alpha',
    workspaceId: 'wrk_alpha'
  }
}

export function schemaFixture(overrides: Partial<ReturnType<typeof schemaFixtureBase>> = {}) {
  return { ...schemaFixtureBase(), ...overrides }
}

export function schemaFixtureBase() {
  return {
    schemaName: 'public',
    state: 'active',
    ownerRoleName: 'postgres_owner',
    objectCounts: {
      tables: 1,
      views: 1,
      materializedViews: 1,
      indexes: 2
    }
  }
}

export function tableFixture(overrides: Partial<ReturnType<typeof tableFixtureBase>> = {}) {
  return { ...tableFixtureBase(), ...overrides }
}

export function tableFixtureBase() {
  return {
    tableName: 'accounts',
    state: 'active',
    columnCount: 2
  }
}

export function columnFixture(overrides: Partial<ReturnType<typeof columnFixtureBase>> = {}) {
  return { ...columnFixtureBase(), ...overrides }
}

export function columnFixtureBase() {
  return {
    columnName: 'id',
    dataType: { typeName: 'uuid' },
    nullable: false,
    defaultExpression: 'gen_random_uuid()',
    ordinalPosition: 1
  }
}

export function indexFixture(overrides: Partial<ReturnType<typeof indexFixtureBase>> = {}) {
  return { ...indexFixtureBase(), ...overrides }
}

export function indexFixtureBase() {
  return {
    indexName: 'accounts_pkey',
    indexMethod: 'btree',
    unique: true,
    keys: [{ columnName: 'id' }],
    includeColumns: ['email']
  }
}

export function policyFixture(overrides: Partial<ReturnType<typeof policyFixtureBase>> = {}) {
  return { ...policyFixtureBase(), ...overrides }
}

export function policyFixtureBase() {
  return {
    policyName: 'accounts_select_policy',
    policyMode: 'permissive',
    state: 'active',
    appliesTo: {
      command: 'select',
      roles: ['tenant_user']
    },
    usingExpression: 'tenant_id = current_setting(\'app.tenant_id\')'
  }
}

export function securityFixture(overrides: Partial<ReturnType<typeof securityFixtureBase>> = {}) {
  return { ...securityFixtureBase(), ...overrides }
}

export function securityFixtureBase() {
  return {
    rlsEnabled: true,
    forceRls: true,
    policyCount: 2,
    sharedTableClassification: 'tenant_scoped',
    state: 'review_required'
  }
}

export function viewFixture(overrides: Partial<ReturnType<typeof viewFixtureBase>> = {}) {
  return { ...viewFixtureBase(), ...overrides }
}

export function viewFixtureBase() {
  return {
    viewName: 'active_accounts',
    state: 'active',
    columns: ['id', 'email'],
    query: 'select id, email from public.accounts where active = true',
    securityBarrier: true
  }
}

export function matViewFixture(overrides: Partial<ReturnType<typeof matViewFixtureBase>> = {}) {
  return { ...matViewFixtureBase(), ...overrides }
}

export function matViewFixtureBase() {
  return {
    viewName: 'accounts_snapshot',
    state: 'active',
    columns: ['id', 'email'],
    query: 'select id, email from public.accounts',
    withData: true,
    refreshPolicy: 'daily refresh',
    integrityProfile: {
      populationState: 'loaded'
    }
  }
}

export function warningFixture(overrides: Partial<ReturnType<typeof warningFixtureBase>> = {}) {
  return { ...warningFixtureBase(), ...overrides }
}

export function warningFixtureBase() {
  return {
    warningCode: 'lock_risk',
    severity: 'high',
    category: 'locks',
    summary: 'Exclusive lock possible',
    impactLevel: 'high',
    requiresAcknowledgement: true,
    detail: 'The preview detects an ACCESS EXCLUSIVE lock target.'
  }
}

export function ddlPreviewFixture(overrides: Partial<ReturnType<typeof ddlPreviewFixtureBase>> = {}) {
  return { ...ddlPreviewFixtureBase(), ...overrides }
}

export function ddlPreviewFixtureBase() {
  return {
    ddlPreview: {
      executionMode: 'preview',
      statementCount: 1,
      statements: [
        {
          ordinal: 1,
          category: 'create',
          destructive: false,
          sql: 'CREATE TABLE public.accounts (id uuid primary key);'
        }
      ],
      transactionMode: 'transactional_ddl',
      safeGuards: ['preview_only'],
      lockTargets: ['public.accounts']
    },
    preExecutionWarnings: [warningFixture()],
    riskProfile: {
      riskLevel: 'high',
      statementCount: 1,
      lockTargetCount: 1,
      blockingLikely: true,
      destructive: false,
      acknowledgementRequired: true
    }
  }
}

export const paths = {
  databases: '/v1/postgres/databases',
  schemas: '/v1/postgres/databases/app_db/schemas',
  tables: '/v1/postgres/databases/app_db/schemas/public/tables',
  views: '/v1/postgres/databases/app_db/schemas/public/views',
  matviews: '/v1/postgres/databases/app_db/schemas/public/materialized-views',
  columns: '/v1/postgres/databases/app_db/schemas/public/tables/accounts/columns',
  indexes: '/v1/postgres/databases/app_db/schemas/public/tables/accounts/indexes',
  policies: '/v1/postgres/databases/app_db/schemas/public/tables/accounts/policies',
  security: '/v1/postgres/databases/app_db/schemas/public/tables/accounts/security',
}
export const pageUrl = (path: string, cursor?: string) => `${path}?page%5Bsize%5D=100${cursor ? `&page%5Bafter%5D=${encodeURIComponent(cursor)}` : ''}`
export const fixtures = { databases: { items: [dbFixture(), dbFixture({ databaseName: 'analytics' }), dbFixture({ databaseName: 'archive' })], page: {} }, schemas: { items: [schemaFixture()], page: {} }, tables: { items: [tableFixture()], page: {} }, views: { items: [viewFixture()], page: {} }, matviews: { items: [matViewFixture()], page: {} }, columns: { items: [columnFixture()], page: {} }, indexes: { items: [indexFixture()], page: {} }, policies: { items: [policyFixture()], page: {} }, security: securityFixture() }
export const reads = Object.fromEntries(Object.entries(paths).map(([kind, path]) => [`GET ${kind === 'security' ? path : pageUrl(path)}`, fixtures[kind as keyof typeof fixtures]]))
export const metricPaths = ['/v1/metrics/tenants/t-1/quotas', '/v1/metrics/tenants/t-1/overview', '/v1/metrics/workspaces/ws-1/quotas', '/v1/metrics/workspaces/ws-1/overview']
export const metrics = Object.fromEntries(metricPaths.map((path) => [`GET ${path}`, { dimensions: [] }]))
export default {
  route: '/console/postgres', roles: ['tenant_owner', 'tenant_viewer'], fixtures: ['pg-databases', 'pg-schemas', 'pg-tables', 'pg-views', 'pg-matviews', 'pg-table-detail', 'pg-cursor-set', 'pg-retry-set', 'pg-delayed-set', 'pg-ddl-preview-table'],
  sources: ['src/pages/consolePostgres.tsx', 'src/pages/consolePostgres'], data: [{ name: 'databases', locator: '[data-testid="postgres-page"] table' }], actions: [], states: [], endpoints: {},
} satisfies import('../manifest').ParityManifest
