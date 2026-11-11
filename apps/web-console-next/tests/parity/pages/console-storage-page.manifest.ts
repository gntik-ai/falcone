import type { EndpointResponse, PageEndpoint, ParityManifest } from '../manifest'
// Ported legacy ConsoleStoragePage.test fixtures; only shell tenant/workspace ids are adapted.
export function mockBuckets(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        resourceId: 'res_bucket_1',
        tenantId: 'synthetic-tenant',
        workspaceId: 'synthetic-workspace',
        bucketName: 'media-assets',
        region: 'eu-west-1',
        status: 'active',
        provisioning: { state: 'active' },
        timestamps: { createdAt: '2026-03-29T06:00:00.000Z' }
      },
      {
        resourceId: 'res_bucket_2',
        tenantId: 'synthetic-tenant',
        workspaceId: 'wrk_other',
        bucketName: 'other-workspace',
        region: 'eu-west-1',
        status: 'active',
        provisioning: { state: 'active' },
        timestamps: { createdAt: '2026-03-29T06:05:00.000Z' }
      }
    ],
    page: { size: 100 },
    ...overrides
  }
}

export function mockObjects(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        resourceId: 'res_obj_1',
        bucketResourceId: 'res_bucket_1',
        bucketName: 'media-assets',
        objectKey: 'media/hero.png',
        contentType: 'image/png',
        sizeBytes: 4096,
        etag: 'etag-hero',
        metadata: { owner: 'design' },
        storageClass: 'standard',
        timestamps: {
          createdAt: '2026-03-29T06:00:00.000Z',
          updatedAt: '2026-03-29T06:10:00.000Z',
          lastModifiedAt: '2026-03-29T06:10:00.000Z'
        }
      }
    ],
    page: { size: 50, nextCursor: 'cursor-next' },
    ...overrides
  }
}

export function mockObjectMetadata(overrides: Record<string, unknown> = {}) {
  return {
    resourceId: 'res_obj_1',
    bucketResourceId: 'res_bucket_1',
    bucketName: 'media-assets',
    objectKey: 'media/hero.png',
    contentType: 'image/png',
    sizeBytes: 4096,
    etag: 'etag-hero',
    metadata: { owner: 'design', locale: 'es-ES' },
    storageClass: 'standard',
    checksumSha256: 'abcdef1234567890abcdef1234567890',
    versionId: 'ver_1',
    providerType: 's3',
    applicationId: 'app_alpha',
    namespace: 'public',
    timestamps: {
      createdAt: '2026-03-29T06:00:00.000Z',
      updatedAt: '2026-03-29T06:10:00.000Z',
      lastModifiedAt: '2026-03-29T06:10:00.000Z'
    },
    ...overrides
  }
}

export function mockUsage(overrides: Record<string, unknown> = {}) {
  return {
    collectionMethod: 'cached_snapshot',
    collectionStatus: 'ok',
    snapshotAt: '2026-03-29T06:00:00.000Z',
    cacheSnapshotAt: '2026-03-29T06:25:00.000Z',
    dimensions: {
      totalBytes: { dimension: 'total_bytes', used: 8192, limit: 16384, remaining: 8192, utilizationPercent: 50 },
      bucketCount: { dimension: 'bucket_count', used: 1, limit: null, remaining: null, utilizationPercent: null },
      objectCount: { dimension: 'object_count', used: 24, limit: null, remaining: null, utilizationPercent: null },
      objectSizeBytes: { dimension: 'object_size_bytes', used: 8192, limit: null, remaining: null, utilizationPercent: null }
    },
    buckets: [
      {
        bucketId: 'res_bucket_1',
        totalBytes: 8192,
        objectCount: 24,
        largestObjectSizeBytes: 4096
      }
    ],
    ...overrides
  }
}


export const bucket = mockBuckets().items[0]
export const bucketsPath = '/v1/storage/buckets?page[size]=100'
export const usagePath = '/v1/storage/workspaces/synthetic-workspace/usage'
export const objectsPath = `/v1/storage/buckets/${bucket.resourceId}/objects?page%5Bsize%5D=50`
export const nextPath = `${objectsPath}&page%5Bafter%5D=cursor-next`
export const metadataPath = `/v1/storage/buckets/${bucket.resourceId}/objects/media%2Fhero.png/metadata`
export const presignPath = `/v1/storage/buckets/${bucket.resourceId}/objects/media%2Fhero.png/presign`
export const createPath = '/v1/storage/workspaces/synthetic-workspace/buckets'
export const uploadPath = `/v1/storage/buckets/${bucket.resourceId}/objects/hello.txt`
export const exportPath = `/v1/storage/workspaces/synthetic-workspace/buckets/${bucket.resourceId}/exports`
export const deletePath = `/v1/storage/buckets/${bucket.resourceId}`
export const page2 = { items: [{ ...mockObjects().items[0], objectKey: 'media/manual.pdf', sizeBytes: 2048, contentType: 'application/pdf', etag: 'etag-pdf' }], page: {} }
export const presigned = { operation: 'download', bucketName: bucket.bucketName, objectKey: 'media/hero.png', expiresAt: '2026-03-29T06:30:00Z', ttlSeconds: 300, ttlClamped: true, url: 'https://storage.invalid/synthetic-download' }
export const manifestBody = { manifestId: 'manifest-synthetic', totalObjects: 1, entries: [] }
export const failure = (status: number): EndpointResponse => ({ status, body: { status, code: `HTTP_${status}`, requestId: 'req_synthetic_storage', message: 'synthetic-error' } })
export const ok = (body: unknown): EndpointResponse => ({ status: 200, body })
export const responses = (body: unknown): Record<string, EndpointResponse | EndpointResponse[]> => ({ success: ok(body), delayed: { ...ok(body), delayMs: 1500 }, '401': [failure(401), ok(body)], '403': failure(403), '404': failure(404), '500': failure(500), network: { network: true } })
export const endpoints: Record<string, PageEndpoint> = {
  buckets: { method: 'GET', path: bucketsPath, fixtures: { ...responses(mockBuckets()), empty: ok(mockBuckets({ items: [] })), normalized: ok(mockBuckets({ items: [...mockBuckets().items, { ...bucket, resourceId: 'new-id', bucketName: 'wrk-1-mi-bucket' }] })), incomplete: ok(mockBuckets({ items: [{ ...bucket, resourceId: 'new-id', bucketName: 'media' }], page: { after: 'next' } })), conclusive: ok(mockBuckets({ items: [...mockBuckets().items, { ...bucket, resourceId: 'new-id', bucketName: 'media' }] })) } },
  usage: { method: 'GET', path: usagePath, fixtures: { ...responses(mockUsage()), unavailable: ok(mockUsage({ collectionStatus: 'provider_unavailable' })), noQuota: ok(mockUsage({ dimensions: {} })), noBreakdown: ok(mockUsage({ buckets: [] })) } },
  objects: { method: 'GET', path: objectsPath, fixtures: { ...responses(mockObjects()), empty: ok(mockObjects({ items: [], page: {} })) } },
  next: { method: 'GET', path: nextPath, fixtures: responses(page2) },
  metadata: { method: 'GET', path: metadataPath, fixtures: { ...responses(mockObjectMetadata()), noCustom: ok(mockObjectMetadata({ metadata: {} })) } },
  presign: { method: 'POST', path: presignPath, fixtures: responses(presigned) },
  create: { method: 'POST', path: createPath, fixtures: responses({ bucket }) },
  upload: { method: 'PUT', path: uploadPath, fixtures: responses({ objectKey: 'hello.txt', sizeBytes: 5 }) },
  export: { method: 'POST', path: exportPath, fixtures: responses(manifestBody) },
  delete: { method: 'DELETE', path: deletePath, fixtures: responses({}) },
}
export const fixtureFamilies = [
  'shell-tenant-owner-active-workspace', 'storage-buckets-mixed-workspaces', 'storage-usage-with-quota', 'storage-objects-page1-with-cursor', 'storage-object-metadata', 'shell-tenant-switch', 'shell-workspace-switch', 'storage-buckets-other-context', 'storage-context-switch-late-responses', 'storage-buckets-empty', 'storage-objects-empty', 'storage-bucket-no-timestamps', 'storage-usage-no-bucket-breakdown', 'storage-object-metadata-no-custom', 'storage-usage-provider-unavailable', 'storage-usage-stale', 'storage-usage-no-quota-limit', 'storage-bucket-create-201', 'storage-bucket-export-200', 'storage-bucket-delete-200', 'storage-objects-page2', 'storage-object-upload-200', 'storage-object-presign-200', 'clipboard-api-stub', 'clipboard-api-unavailable', 'shell-no-tenant', 'shell-no-workspace', 'storage-bucket-create-unnamed-network',
  ...['buckets', 'usage', 'objects', 'objects-append', 'metadata', 'presign', 'create', 'upload', 'export', 'delete'].map((section) => `storage-sections-delayed[section=${section}]`),
  ...['buckets', 'usage', 'objects', 'metadata'].flatMap((section) => ['401', '403', '404', '500', 'network'].map((status) => `storage-read-errors[section=${section}][status=${status}]`)),
  ...['401', '403', '404', '500', 'network'].map((status) => `storage-presign-errors[status=${status}]`),
  ...['create', 'upload', 'export', 'delete'].flatMap((action) => ['401-refresh-fail', '401-refresh-ok', '403', '404', '500', 'network'].map((status) => `storage-mutation-errors[action=${action}][status=${status}]`)),
  ...['create', 'upload', 'export', 'delete'].flatMap((action) => ['200', 'already-applied'].map((outcome) => `storage-mutation-retry[action=${action}][outcome=${outcome}]`)),
]
endpoints.buckets.fixtures.noHistory = ok(mockBuckets({ items: [{ ...bucket, timestamps: {} }] }))
endpoints.buckets.fixtures.otherContext = ok({ items: [{ ...bucket, resourceId: 'other-resource', workspaceId: 'synthetic-other', bucketName: 'other-context' }], page: {} })
const manifest: ParityManifest = {
  route: '/console/storage', roles: ['superadmin', 'tenant_owner', 'tenant_viewer'], endpoints,
  fixtures: fixtureFamilies, sources: ['src/pages/consoleStorage.tsx', 'src/pages/consoleStorage'],
  data: [{ name: 'title', locator: { es: 'h1:text-is("Almacenamiento / objetos")', en: 'h1:text-is("Storage / objects")' } }], actions: [], states: [],
}
export default manifest
