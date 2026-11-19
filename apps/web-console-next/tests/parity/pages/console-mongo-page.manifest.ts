// Synthetic fixtures for /console/mongo, ported from the legacy ConsoleMongoPage tests and console-service-e2e journeys.
export const tenant = 't-1'
export const workspace = 'ws-1'
export const database = 'catalog'
export const collection = 'orders'

export const databasesPath = '/v1/mongo/databases'
export const collectionsPath = `${databasesPath}/${database}/collections`
export const viewsPath = `${databasesPath}/${database}/views`
export const detailPath = `${collectionsPath}/${collection}`
export const indexesPath = `${detailPath}/indexes`
export const documentsPath = `/v1/mongo/workspaces/${workspace}/data/${database}/collections/${collection}/documents`
export const submitPath = `/v1/workspaces/${workspace}/databases`
export const metricPaths = [`/v1/metrics/tenants/${tenant}/quotas`, `/v1/metrics/tenants/${tenant}/overview`, `/v1/metrics/workspaces/${workspace}/quotas`, `/v1/metrics/workspaces/${workspace}/overview`]

// Lists keep the legacy literal query; documents keep the legacy URLSearchParams encoding.
export const listUrl = (path: string, cursor?: string) => `${path}?page[size]=100${cursor ? `&page[after]=${encodeURIComponent(cursor)}` : ''}`
export const documentsUrl = (cursor?: string) => `${documentsPath}?page%5Bsize%5D=20${cursor ? `&page%5Bafter%5D=${encodeURIComponent(cursor)}` : ''}`
export const urls = {
  databases: (cursor?: string) => listUrl(databasesPath, cursor),
  collections: (cursor?: string) => listUrl(collectionsPath, cursor),
  views: (cursor?: string) => listUrl(viewsPath, cursor),
  detail: () => detailPath,
  indexes: (cursor?: string) => listUrl(indexesPath, cursor),
  documents: documentsUrl,
}

export const databaseRow = (name: string, overrides: Record<string, unknown> = {}) => ({ databaseName: name, stats: { dataSize: 2048, storageSize: 4096, collections: 4, indexes: 7 }, ...overrides })
export const collectionRow = (name: string, overrides: Record<string, unknown> = {}) => ({ collectionName: name, collectionType: 'standard', documentCount: 12, estimatedSize: 8192, ...overrides })
export const indexRow = (name: string, overrides: Record<string, unknown> = {}) => ({ indexName: name, keys: [{ fieldName: name.replace(/_\d+$/, ''), direction: 1 }], indexType: 'single', unique: false, sparse: false, rebuildState: 'idle', ...overrides })
export const documentRow = (id: string, overrides: Record<string, unknown> = {}) => ({ _id: id, status: 'open', ...overrides })

export const fixtures = {
  databases: { items: [databaseRow('catalog'), databaseRow('billing')], page: {} },
  databasesCursor: { items: [databaseRow('catalog'), databaseRow('billing')], page: { nextCursor: 'db/cursor+1' } },
  databasesNext: { items: [databaseRow('archive')], page: {} },
  collections: { items: [collectionRow(collection, { collectionType: 'time-series', validation: { validator: { bsonType: 'object' } } }), collectionRow('events', { collectionType: 'capped' }), collectionRow('users')], page: {} },
  collectionsCursor: { items: [collectionRow(collection, { validation: { validator: { bsonType: 'object' } } })], page: { nextCursor: 'col-2' } },
  collectionsNext: { items: [collectionRow('audit')], page: {} },
  views: { items: [{ viewName: 'orders_view', viewOn: collection, pipeline: [{ $match: { status: 'open' } }] }], page: {} },
  viewsCursor: { items: [{ viewName: 'orders_view', viewOn: collection, pipeline: [] }], page: { nextCursor: 'view-2' } },
  viewsNext: { items: [{ viewName: 'events_view', viewOn: 'events', pipeline: [] }], page: {} },
  detail: { collectionName: collection, validation: { validationLevel: 'strict', validationAction: 'error', validator: { bsonType: 'object', required: ['status'] } } },
  detailNoValidator: { collectionName: collection },
  indexes: { items: [indexRow('_id_', { keys: [{ fieldName: '_id', direction: 1 }], unique: true }), indexRow('status_1', { sparse: true, ttlSeconds: 3600, partialFilterExpression: { status: { $exists: true } }, rebuildState: 'failed' })], page: {} },
  indexesCursor: { items: [indexRow('status_1')], page: { nextCursor: 'idx-2' } },
  indexesNext: { items: [indexRow('created_1', { rebuildState: 'in_progress' })], page: {} },
  indexesOnlyId: { items: [indexRow('_id_', { keys: [{ fieldName: '_id', direction: 1 }], unique: true })], page: {} },
  documents: { items: [documentRow('doc-1', { nested: { value: 7 } }), documentRow('doc-2')], page: { after: null, size: 20 } },
  documentsCursor: { items: [documentRow('doc-1')], page: { after: 'cursor-2', size: 20 } },
  documentsNext: { items: [documentRow('doc-2')], page: { after: null, size: 20 } },
  empty: { items: [], page: {} },
  quotaAvailable: { dimensions: [{ dimensionId: 'databases.count', hardLimit: 5, measuredValue: 1 }] },
  quotaExhausted: { dimensions: [{ dimensionId: 'databases.count', hardLimit: 1, measuredValue: 1 }] },
}
export const metrics = Object.fromEntries(metricPaths.map((path) => [`GET ${path}`, { dimensions: [] }]))

// Contract CA-1302-1, sha256 abd13406767f14579bf13744da417c122f7117cb5be7f26961b07c097ad94c23.
// Each fixture states the status, error code and X-Idempotency-Replayed value the backend emits for POST /v1/workspaces/{workspaceId}/databases.
export const contract = { id: 'CA-1302-1', sha256: 'abd13406767f14579bf13744da417c122f7117cb5be7f26961b07c097ad94c23' }
type Idempotency = { contract: string; status: number; code?: string; replayed?: 'true'; headers?: Record<string, string>; body?: unknown }
export const idempotency: Record<string, Idempotency> = {
  'create-success': { contract: contract.id, status: 201, body: { databaseId: 'catalog', database: { databaseName: 'catalog' }, engine: 'mongodb', workspaceId: workspace } },
  'create-replayed': { contract: contract.id, status: 201, replayed: 'true', body: { databaseId: 'catalog', database: { databaseName: 'catalog' }, engine: 'mongodb', workspaceId: workspace } },
  'create-500': { contract: contract.id, status: 502, code: 'MONGO_PROVISION_FAILED', body: { code: 'MONGO_PROVISION_FAILED', message: 'raw-backend-message', requestId: 'req-mongo-500' } },
  'create-503': { contract: contract.id, status: 503, code: 'IDEMPOTENCY_UNAVAILABLE', body: { code: 'IDEMPOTENCY_UNAVAILABLE', message: 'raw-backend-message', requestId: 'req-mongo-503' } },
  'create-400-key': { contract: contract.id, status: 400, code: 'INVALID_IDEMPOTENCY_KEY', body: { code: 'INVALID_IDEMPOTENCY_KEY', message: 'raw-backend-message' } },
  'create-in-progress': { contract: contract.id, status: 409, code: 'IDEMPOTENCY_KEY_IN_PROGRESS', headers: { 'Retry-After': '1' }, body: { code: 'IDEMPOTENCY_KEY_IN_PROGRESS', message: 'raw-backend-message' } },
  'create-replay-unavailable': { contract: contract.id, status: 409, code: 'IDEMPOTENCY_REPLAY_UNAVAILABLE', body: { code: 'IDEMPOTENCY_REPLAY_UNAVAILABLE', message: 'raw-backend-message' } },
  'create-mismatch': { contract: contract.id, status: 422, code: 'IDEMPOTENCY_KEY_MISMATCH', body: { code: 'IDEMPOTENCY_KEY_MISMATCH', message: 'raw-backend-message' } },
  'create-403': { contract: contract.id, status: 403, body: { code: 'FORBIDDEN', message: 'raw-backend-message' } },
  'create-409': { contract: contract.id, status: 409, code: 'DB_ALREADY_PROVISIONED', body: { code: 'DB_ALREADY_PROVISIONED', message: 'raw-backend-message' } },
  // The PostgreSQL 201 carries a one-time credential that the page must never render, store or announce.
  'create-postgres-credential': { contract: contract.id, status: 201, body: { databaseId: 'pg-created', database: 'pg-created', connection: { host: 'synthetic-host', password: 'synthetic-one-time-secret' }, sagaId: 'saga-1' } },
}
export const response = (name: string) => {
  const fixture = idempotency[name]
  const headers = new Headers({ 'content-type': 'application/json', ...fixture.headers, ...(fixture.replayed ? { 'X-Idempotency-Replayed': fixture.replayed } : {}) })
  return new Response(JSON.stringify(fixture.body ?? {}), { status: fixture.status, headers })
}

export default {
  route: '/console/mongo', roles: ['tenant_owner', 'tenant_viewer'],
  fixtures: [
    'shell:tenant-operator-with-workspace', 'mongo.databases:first-page-with-cursor', 'mongo.databases:last-page', 'mongo.collections:success', 'mongo.collections:first-page-with-cursor',
    'mongo.views:success', 'mongo.collection-detail:with-validator', 'mongo.indexes:success', 'mongo.documents:page-with-cursor', 'mongo.documents:last-page',
    'metrics.quotas:workspace-available', 'metrics.quotas:workspace-exhausted', 'shell:workspace-switch',
    'workspaces.databases:create-success', 'workspaces.databases:create-500-then-success', 'workspaces.databases:create-network-then-success',
    'mongo.databases:empty', 'mongo.collections:empty', 'mongo.views:500', 'mongo.indexes:only-id', 'mongo.collection-detail:no-validator', 'mongo.documents:empty',
    'mongo.databases:401', 'mongo.databases:403', 'mongo.collection-detail:404', 'mongo.documents:network', 'mongo.databases:next-page-500',
    'shell:no-workspace', 'shell:no-tenant', 'shell:no-provision-permission',
    'workspaces.databases:create-500', 'workspaces.databases:create-network', 'workspaces.databases:create-403', 'workspaces.databases:create-409',
    'mongo.indexes:rebuild-failed', 'mongo.collections:slow',
    ...Object.keys(idempotency).map((name) => `workspaces.databases:${name} (${contract.id})`),
  ],
  sources: ['src/pages/consoleMongo.tsx', 'src/pages/consoleMongo'], data: [{ name: 'databases', locator: '[data-testid="mongo-page"] table' }], actions: [], states: [], endpoints: {},
} satisfies import('../manifest').ParityManifest
