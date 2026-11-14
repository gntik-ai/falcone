// Synthetic fixtures for the row editor and API-key panel. Keys are obvious placeholders, never real credentials.
export const workspace = 'ws-1'
export const target = { database: 'app_db', schema: 'public', table: 'accounts' }
export const rowsBase = `/v1/postgres/workspaces/${workspace}/data/${target.database}/schemas/${target.schema}/tables/${target.table}`
export const rowsPath = `${rowsBase}/rows`
export const byKeyPath = `${rowsBase}/rows/by-primary-key`
export const keysPath = `/v1/workspaces/${workspace}/api-keys`

// URLSearchParams order used by the client: page[size], page[after], countMode, then one parameter per filter.
export function rowsUrl({ size = 25, after, filters = [], base = rowsPath }: { size?: number; after?: string; filters?: [string, string][]; base?: string } = {}) {
  const params = new URLSearchParams({ 'page[size]': String(size) })
  if (after) params.set('page[after]', after)
  params.set('countMode', 'exact')
  for (const [column, value] of filters) params.append(column, value)
  return `${base}?${params}`
}
export const previewUrl = `${rowsPath}?page%5Bsize%5D=10`

export const accountRow = (index: number, overrides: Record<string, unknown> = {}) => ({ id: `acc_${String(index).padStart(2, '0')}`, email: `user${index}@example.test`, plan: index % 2 ? 'basic' : 'pro', ...overrides })
export const pageRows = (from: number, count: number) => Array.from({ length: count }, (_, i) => accountRow(from + i))

export const synthetic = { anon: 'synthetic-anon-key', service: 'synthetic-service-key' }
export const fixtures = {
  'pg-rows-page1': { items: pageRows(1, 25), page: { size: 25, returned: 25, after: 'c1' }, count: 60 },
  'pg-rows-page2': { items: pageRows(26, 25), page: { size: 25, returned: 25 }, count: 60 },
  'pg-rows-filtered': { items: [accountRow(1)], page: { size: 25, returned: 1 }, count: 1 },
  'pg-rows-empty': { items: [], page: { size: 25, returned: 0 }, count: 0 },
  'pg-rows-after-insert': { items: [...pageRows(1, 24), accountRow(61, { email: 'new@example.test' })], page: { size: 25, returned: 25, after: 'c1' }, count: 61 },
  'pg-rows-after-patch': { items: [accountRow(1, { plan: 'enterprise' }), ...pageRows(2, 24)], page: { size: 25, returned: 25, after: 'c1' }, count: 60 },
  'pg-rows-after-delete': { items: pageRows(2, 24), page: { size: 25, returned: 24, after: 'c1' }, count: 59 },
  'pg-rows-preview-apikey': { items: [{ id: 'acc_01', plan: 'basic' }, { id: 'acc_02', plan: 'pro' }], page: { size: 10, returned: 2 } },
  'pg-row-insert-ok': { item: accountRow(61) },
  'pg-row-patch-ok': { item: accountRow(1, { plan: 'enterprise' }), affected: 1 },
  'pg-row-delete-ok': { affected: 1 },
  'pg-api-keys': { items: [
    { id: 'key-anon-1', key_type: 'anon', key_prefix: 'syn_anon_01', scopes: ['read'], status: 'active', created_at: '2026-06-01T10:00:00Z', last_used_at: null },
    { id: 'key-service-1', key_type: 'service', key_prefix: 'syn_svc_01', scopes: ['read', 'write'], status: 'revoked', created_at: '2026-05-01T10:00:00Z', last_used_at: '2026-05-20T10:00:00Z' },
  ] },
  'pg-api-keys-empty': { items: [] },
  'pg-api-keys-after-revoke': { items: [
    { id: 'key-anon-1', key_type: 'anon', key_prefix: 'syn_anon_01', scopes: ['read'], status: 'revoked', created_at: '2026-06-01T10:00:00Z', last_used_at: null },
    { id: 'key-service-1', key_type: 'service', key_prefix: 'syn_svc_01', scopes: ['read', 'write'], status: 'revoked', created_at: '2026-05-01T10:00:00Z', last_used_at: '2026-05-20T10:00:00Z' },
  ] },
  'pg-api-key-revoke-ok': { id: 'key-anon-1', revoked: true },
  'pg-api-key-issue-anon': { id: 'key-anon-2', key: synthetic.anon, prefix: 'syn_anon_02', keyType: 'anon', scopes: ['read'] },
  'pg-api-key-issue-service': { id: 'key-service-2', key: synthetic.service, prefix: 'syn_svc_02', keyType: 'service', scopes: ['read', 'write'] },
}

export default {
  route: '/console/postgres/data', roles: ['tenant_owner', 'tenant_viewer'],
  fixtures: [
    'pg-rows-page1', 'pg-rows-page2', 'pg-rows-empty', 'pg-rows-filtered',
    'pg-rows-after-insert', 'pg-rows-after-patch', 'pg-rows-after-delete', 'pg-rows-preview-apikey',
    'pg-row-insert-ok', 'pg-row-patch-ok', 'pg-row-delete-ok', 'pg-rows-delayed',
    'pg-rows-401', 'pg-rows-403', 'pg-rows-404', 'pg-rows-500',
    'pg-rows-network', 'pg-rows-500-then-ok', 'pg-row-insert-500', 'pg-row-insert-slow',
    'pg-row-patch-slow', 'pg-rows-preview-slow',
    'pg-api-keys', 'pg-api-keys-empty', 'pg-api-keys-after-revoke', 'pg-api-key-revoke-ok',
    'pg-api-key-issue-anon', 'pg-api-key-issue-service', 'pg-api-keys-delayed', 'pg-api-keys-403',
    'pg-api-keys-500-then-ok',
  ],
  sources: ['src/pages/consolePostgresData.tsx', 'src/pages/consolePostgresData'], data: [{ name: 'rows', locator: '[data-testid="postgres-data-page"] table' }], actions: [], states: [], endpoints: {},
} satisfies import('../manifest').ParityManifest
