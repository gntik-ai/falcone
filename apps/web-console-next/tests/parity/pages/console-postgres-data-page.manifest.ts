// Synthetic fixtures for the Postgres data editor. Every key value is synthetic; none is a real credential.
export const databaseName = 'app_db', schemaName = 'public', tableName = 'accounts'
export const rowsPath = (workspace = 'ws-1', schema = schemaName, table = tableName) => `/v1/postgres/workspaces/${workspace}/data/${databaseName}/schemas/${schema}/tables/${table}/rows`
export const byKeyPath = (workspace = 'ws-1') => `${rowsPath(workspace)}/by-primary-key`
export const keysPath = (workspace = 'ws-1') => `/v1/workspaces/${workspace}/api-keys`
export const query = (params: Array<[string, string]>) => { const search = new URLSearchParams(); for (const [key, value] of params) search.append(key, value); return search.toString() }
export const rowsUrl = ({ workspace = 'ws-1', size = 25, after, filters = [], table = tableName }: { workspace?: string; size?: number; after?: string; filters?: Array<[string, string]>; table?: string } = {}) =>
  `${rowsPath(workspace, schemaName, table)}?${query([['page[size]', String(size)], ...(after ? [['page[after]', after] as [string, string]] : []), ['countMode', 'exact'], ...filters])}`
export const previewUrl = (workspace = 'ws-1') => `${rowsPath(workspace)}?page%5Bsize%5D=10`

export const account = (n: number) => ({ id: `acc-${n}`, email: `user${n}@example.test`, plan: n % 2 ? 'free' : 'pro' })
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => account(from + index))
export const pg = {
  'pg-rows-page1': { items: range(1, 25), page: { size: 25, returned: 25, after: 'c1' }, count: 60 },
  'pg-rows-page2': { items: range(26, 50), page: { size: 25, returned: 25, after: 'c2' }, count: 60 },
  'pg-rows-empty': { items: [], page: { size: 25, returned: 0 }, count: 0 },
  'pg-rows-after-insert': { items: [{ id: 'acc-new', email: 'new@example.test', plan: 'free' }, ...range(1, 24)], page: { size: 25, returned: 25, after: 'c1' }, count: 61 },
  'pg-rows-after-patch': { items: [{ ...account(1), email: 'edited@example.test' }, ...range(2, 25)], page: { size: 25, returned: 25, after: 'c1' }, count: 60 },
  'pg-rows-after-delete': { items: range(2, 26), page: { size: 25, returned: 25, after: 'c1' }, count: 59 },
  'pg-row-insert-ok': { item: { id: 'acc-new', email: 'new@example.test', plan: 'free' } },
  'pg-row-patch-ok': { item: { ...account(1), email: 'edited@example.test' }, affected: 1 },
  'pg-row-delete-ok': { affected: 1 },
  'pg-api-keys': { items: [
    { id: 'key-1', key_type: 'anon', key_prefix: 'fk_anon_ab12', scopes: ['rows:read'], status: 'active', created_at: '2026-01-01T00:00:00Z', last_used_at: null },
    { id: 'key-2', key_type: 'service', key_prefix: 'fk_svc_cd34', scopes: ['rows:write'], status: 'revoked', created_at: '2026-01-02T00:00:00Z', last_used_at: null },
  ] },
  'pg-api-keys-after-revoke': { items: [
    { id: 'key-1', key_type: 'anon', key_prefix: 'fk_anon_ab12', scopes: ['rows:read'], status: 'revoked', created_at: '2026-01-01T00:00:00Z', last_used_at: null },
    { id: 'key-2', key_type: 'service', key_prefix: 'fk_svc_cd34', scopes: ['rows:write'], status: 'revoked', created_at: '2026-01-02T00:00:00Z', last_used_at: null },
  ] },
  'pg-api-keys-empty': { items: [] },
  'pg-api-key-revoke-ok': { id: 'key-1', revoked: true },
  'pg-api-key-issue-anon': { id: 'key-3', key: 'synthetic-anon-key', prefix: 'fk_anon_ef56', keyType: 'anon', scopes: ['rows:read'] },
  'pg-api-key-issue-service': { id: 'key-4', key: 'synthetic-service-key', prefix: 'fk_svc_gh78', keyType: 'service', scopes: ['rows:write'] },
  'pg-rows-preview-apikey': { items: [{ id: 'prev-1', title: 'Preview row one' }, { id: 'prev-2', title: 'Preview row two' }], page: { size: 10, returned: 2 } },
} as const
export const keysAfterIssue = { items: [...pg['pg-api-keys'].items, { id: 'key-3', key_type: 'anon', key_prefix: 'fk_anon_ef56', scopes: ['rows:read'], status: 'active', created_at: '2026-01-03T00:00:00Z', last_used_at: null }] }

export default {
  route: '/console/postgres/data', roles: ['tenant_owner', 'tenant_viewer'],
  fixtures: [
    'pg-rows-page1',
    'pg-rows-page2',
    'pg-row-insert-ok',
    'pg-rows-after-insert',
    'pg-row-patch-ok',
    'pg-rows-after-patch',
    'pg-row-delete-ok',
    'pg-rows-after-delete',
    'pg-api-keys',
    'pg-api-key-issue-anon',
    'pg-api-key-issue-service',
    'pg-api-key-revoke-ok',
    'pg-api-keys-after-revoke',
    'pg-rows-preview-apikey',
    'pg-rows-empty',
    'pg-api-keys-empty',
    'pg-rows-401',
    'pg-rows-403',
    'pg-api-keys-403',
    'pg-rows-404',
    'pg-rows-500',
    'pg-rows-network',
    'pg-rows-500-then-ok',
    'pg-api-keys-500-then-ok',
    'pg-rows-delayed',
    'pg-api-keys-delayed',
    'pg-row-insert-500',
    'pg-row-insert-slow',
    'pg-row-patch-slow',
    'pg-rows-preview-slow',
  ],
  sources: ['src/pages/consolePostgresData.tsx', 'src/pages/consolePostgresData'], data: [{ name: 'rows', locator: '[data-testid="pgdata-rows"] table' }], actions: [], states: [], endpoints: {},
} satisfies import('../manifest').ParityManifest
