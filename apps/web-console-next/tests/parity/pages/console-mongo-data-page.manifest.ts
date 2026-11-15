// Synthetic fixtures for the document editor and the anonymous-key panel. The key is an obvious placeholder, never a real credential.
export const workspace = 'ws-1'
export const target = { database: 'catalog', collection: 'orders' }
export const docsBase = `/v1/mongo/workspaces/${workspace}/data/${target.database}/collections/${target.collection}/documents`
export const docsPath = docsBase
export const keysPath = `/v1/workspaces/${workspace}/api-keys`

// URLSearchParams order used by the client: page[size], page[after], then filter.
export function docsUrl({ size = 25, after, filter, base = docsPath }: { size?: number; after?: string; filter?: Record<string, unknown>; base?: string } = {}) {
  const params = new URLSearchParams({ 'page[size]': String(size) })
  if (after) params.set('page[after]', after)
  if (filter && Object.keys(filter).length > 0) params.set('filter', JSON.stringify(filter))
  return `${base}?${params}`
}
export const previewUrl = `${docsPath}?page%5Bsize%5D=10`

export const orderDoc = (index: number, overrides: Record<string, unknown> = {}) => ({ _id: `ord_${String(index).padStart(2, '0')}`, status: index % 2 ? 'pending' : 'paid', total: index * 10, ...overrides })
export const pageDocs = (from: number, count: number) => Array.from({ length: count }, (_, i) => orderDoc(from + i))

export const synthetic = { anon: 'synthetic-anon-key' }
export const fixtures = {
  'mongo:documents-page-1': { items: pageDocs(1, 3), page: { size: 25, returned: 3, after: 'c1' } },
  'mongo:documents-page-2': { items: pageDocs(4, 3), page: { size: 25, returned: 3 } },
  'mongo:documents-filtered-paid': { items: [orderDoc(2)], page: { size: 25, returned: 1 } },
  'mongo:documents-size-50': { items: pageDocs(1, 3), page: { size: 50, returned: 3 } },
  'mongo:documents-collection-refunds': { items: [{ _id: 'ref_1', reason: 'damaged' }], page: { size: 25, returned: 1 } },
  'mongo:documents-empty': { items: [], page: { size: 25, returned: 0 } },
  'mongo:document-without-id': { items: [{ status: 'orphan' }], page: { size: 25, returned: 1 } },
  'mongo:documents-after-insert': { items: [...pageDocs(1, 3), orderDoc(7, { status: 'new' })], page: { size: 25, returned: 4, after: 'c1' } },
  'mongo:documents-after-update': { items: [orderDoc(1, { status: 'shipped' }), ...pageDocs(2, 2)], page: { size: 25, returned: 3, after: 'c1' } },
  'mongo:documents-after-delete': { items: pageDocs(2, 2), page: { size: 25, returned: 2, after: 'c1' } },
  'mongo:insert-ok': { item: orderDoc(7, { status: 'new' }) },
  'mongo:update-ok': { item: orderDoc(1, { status: 'shipped' }) },
  'mongo:delete-ok': { deleted: true },
  'mongo:anon-key-issued-synthetic': { id: 'key-anon-1', key: synthetic.anon, prefix: 'syn_anon_01', keyType: 'anon', scopes: ['read'] },
  'mongo:preview-2': { items: [{ _id: 'ord_01', status: 'pending' }, { _id: 'ord_02', status: 'paid' }], page: { size: 10, returned: 2 } },
}

export default {
  route: '/console/mongo/data', roles: ['tenant_owner', 'tenant_viewer'],
  fixtures: [
    'mongo:documents-page-1', 'mongo:documents-page-2', 'mongo:documents-filtered-paid', 'mongo:documents-size-50', 'mongo:documents-collection-refunds',
    'mongo:documents-empty', 'mongo:document-without-id', 'mongo:documents-after-insert', 'mongo:documents-after-update', 'mongo:documents-after-delete',
    'mongo:insert-ok', 'mongo:update-ok', 'mongo:delete-ok', 'mongo:anon-key-issued-synthetic', 'mongo:preview-2',
    'mongo:documents-401', 'mongo:documents-403', 'mongo:documents-404', 'mongo:documents-500', 'mongo:documents-network',
    'mongo:insert-500', 'mongo:update-500', 'mongo:delete-500', 'mongo:preview-401',
    'shell:workspace-active', 'shell:workspace-none',
  ],
  sources: ['src/pages/consoleMongoData.tsx', 'src/pages/consoleMongoData'], data: [{ name: 'documents', locator: '[data-testid="mongo-data-page"] table' }], actions: [], states: [], endpoints: {},
} satisfies import('../manifest').ParityManifest
