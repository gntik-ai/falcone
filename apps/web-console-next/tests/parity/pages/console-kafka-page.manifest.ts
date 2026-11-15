import type { ParityManifest } from '../manifest'
// Rich fixtures copied field for field from legacy ConsoleKafkaPage.test.tsx:50-169.
export function mockInventory(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: 'wrk_alpha',
    tenantId: 'ten_alpha',
    brokerMode: 'kraft',
    isolationMode: 'shared_cluster',
    counts: { total: 1, active: 1, provisioning: 0, degraded: 0 },
    namingPolicy: { topicPrefix: 'evt.' },
    quotaStatus: { limit: 10, used: 3, remaining: 7, enforcementMode: 'none' },
    tenantIsolation: { mode: 'prefix', topicPrefix: 'ten_alpha.' },
    items: [
      {
        resourceId: 'res_topic_1',
        topicName: 'orders.created',
        physicalTopicName: 'evt.ten_alpha.orders.created',
        status: 'active',
        provisioning: { state: 'ACTIVE' },
        cleanupPolicy: 'compact',
        partitionCount: 12,
        retentionHours: 168,
        quotaStatus: { limit: 100, used: 40, remaining: 60, enforcementMode: 'none', maxPublishesPerSecond: 25, maxConcurrentSubscriptions: 12 },
        operationalMetadata: { bridgeIds: ['evb_orders'] }
      }
    ],
    ...overrides
  }
}

export function mockTopicDetail(overrides: Record<string, unknown> = {}) {
  return {
    resourceId: 'res_topic_1',
    topicName: 'orders.created',
    physicalTopicName: 'evt.ten_alpha.orders.created',
    channelPrefix: '/events/orders',
    partitionCount: 12,
    replicationFactor: 3,
    retentionHours: 168,
    cleanupPolicy: 'compact',
    deliverySemantics: 'at_least_once',
    partitionStrategy: 'producer_key',
    partitionSelectionPolicy: 'caller_hint',
    replayWindowHours: 24,
    maxPublishesPerSecond: 25,
    maxConcurrentSubscriptions: 12,
    allowedTransports: ['http_publish', 'sse'],
    provisioning: { state: 'ACTIVE' },
    quotaStatus: { limit: 100, used: 100, remaining: 0, enforcementMode: 'hard', maxPublishesPerSecond: 25, maxConcurrentSubscriptions: 12 },
    tenantIsolation: { mode: 'prefix', topicPrefix: 'ten_alpha.', consumerGroupPrefix: 'cg.ten_alpha.', crossTenantAccessPrevented: true },
    payloadPolicy: { maxPayloadBytes: 4096, compressionHint: 'gzip', schemaValidation: 'none' },
    replayPolicy: { enabled: true, storageBackend: 's3', maxReplayWindowHours: 24 },
    notificationPolicy: { queuesEnabled: true, maxQueueDepth: 50, retentionHours: 12 },
    timestamps: { createdAt: '2026-03-29T05:00:00.000Z', updatedAt: '2026-03-29T06:00:00.000Z' },
    ...overrides
  }
}

export function mockAccessPolicy(overrides: Record<string, unknown> = {}) {
  return {
    resourceId: 'res_topic_1',
    topicName: 'orders.created',
    physicalTopicName: 'evt.ten_alpha.orders.created',
    auditMode: 'metadata_only',
    providerCompatibility: { provider: 'kafka', nativeAclSupport: true },
    aclBindings: [
      {
        principal: 'svc-orders',
        operations: ['READ', 'WRITE'],
        permission: 'ALLOW',
        patternType: 'LITERAL',
        resourceName: 'orders.created',
        workspaceScoped: true
      },
      {
        principal: 'svc-denied',
        operations: ['DELETE'],
        permission: 'DENY',
        patternType: 'PREFIXED',
        resourceName: 'orders',
        workspaceScoped: false
      }
    ],
    ...overrides
  }
}

export function mockMetadata(overrides: Record<string, unknown> = {}) {
  return {
    resourceId: 'res_topic_1',
    sampledAt: '2026-03-29T06:30:00.000Z',
    lag: { totalLag: 1200, maxPartitionLag: 900, consumerGroupId: 'cg-orders', isActive: true },
    retention: { retentionHours: 168, retentionBytes: 1024, effectivePolicy: 'provider_managed' },
    compaction: { enabled: true, lastCompactionTimestamp: '2026-03-29T06:00:00.000Z', compactionLag: 15 },
    partitionMetadata: {
      '0': { lag: 600, logStartOffset: 10, logEndOffset: 610, inSync: true },
      '1': { lag: 300, logStartOffset: 20, logEndOffset: 320, inSync: false }
    },
    technicalLimitations: [{ code: 'KAFKA_PROVIDER_LIMIT', description: 'Metadata parcial' }],
    ...overrides
  }
}

export function mockBridge(overrides: Record<string, unknown> = {}) {
  return {
    bridgeId: 'evb_orders',
    topicRef: 'res_topic_1',
    status: 'DEGRADED',
    source: { sourceType: 'postgres', sourceRef: 'orders_outbox' },
    delivery: { mode: 'at_least_once' },
    audit: { enabled: true },
    ...overrides
  }
}

export function mockPublishAccepted(overrides: Record<string, unknown> = {}) {
  return {
    publicationId: 'pub_123',
    status: 'accepted',
    acceptedAt: '2026-03-29T06:45:00.000Z',
    topicName: 'orders.created',
    ...overrides
  }
}

export const workspace = 'synthetic-workspace'
export const topic = 'res_topic_1'
export const paths = {
 inventory: `/v1/events/workspaces/${workspace}/inventory?page[size]=100`,
 bridge: `/v1/events/workspaces/${workspace}/bridges/evb_orders`,
 detail: `/v1/events/topics/${topic}`, access: `/v1/events/topics/${topic}/access`, metadata: `/v1/events/topics/${topic}/metadata`,
 publish: `/v1/events/topics/${topic}/publish`, stream: `/v1/events/topics/${topic}/stream`, refresh: '/v1/auth/login-sessions/synthetic-session/refresh',
}
const three = mockInventory({ workspaceId: workspace, counts: { total: 3, active: 1, provisioning: 1, degraded: 1 } })
three.items.push({ ...three.items[0], resourceId: 'res_topic_2', topicName: 'orders.pending', provisioning: { state: 'PROVISIONING' }, operationalMetadata: { bridgeIds: [] } }, { ...three.items[0], resourceId: 'res_topic_3', topicName: 'orders.failed', provisioning: { state: 'DEGRADED' }, operationalMetadata: { bridgeIds: [] } })
const many = mockInventory({ workspaceId: workspace, counts: undefined, items: Array.from({ length: 120 }, (_, index) => ({ ...three.items[0], resourceId: `topic-${index}`, topicName: `topic-${index}`, operationalMetadata: {} })) })
export const streamEvents = (count: number) => Array.from({ length: count }, (_, index) => `data: ${JSON.stringify({ key: `key-${index}`, eventType: 'order.created', payload: { sequence: index } })}\n\n`).join('')
export const fixtures = {
 'kafka:inventory-3-with-bridges': three,
 'kafka:inventory-120': many,
 'kafka:inventory-empty': mockInventory({ items: [], counts: {} }),
 'kafka:inventory-counts-no-bridge-ids': mockInventory({ items: [{ ...three.items[0], operationalMetadata: { bridgeCount: 2 } }] }),
 'kafka:bridge-1': mockBridge(), 'kafka:topic-detail': mockTopicDetail(), 'kafka:topic-access': mockAccessPolicy(),
 'kafka:topic-metadata': mockMetadata(),
 'kafka:topic-metadata-legacy-fields': mockMetadata({ lag: { maxMessagesBehind: 44, available: true }, retention: { hours: 48, retentionMs: 1234 }, compaction: { available: true }, partitionMetadata: { available: false } }),
 'kafka:publish-accepted': mockPublishAccepted(),
 'kafka:stream-5-events': streamEvents(5), 'kafka:stream-burst-20': streamEvents(20),
}
export const fixtureNames = [
 ...Object.keys(fixtures), 'kafka:legacy-service-nominal', 'kafka:legacy-service-empty', 'kafka:legacy-service-error', 'shell:tenant-none', 'shell:workspace-none', 'kafka:inventory-401', 'kafka:inventory-401-refresh-rejected', 'kafka:inventory-replay-401', 'kafka:inventory-403', 'kafka:inventory-500', 'kafka:inventory-network', 'kafka:bridge-500', 'kafka:topic-404',
 'kafka:topic-detail-500', 'kafka:topic-access-500', 'kafka:topic-metadata-500', 'kafka:topic-access-403', 'kafka:topic-metadata-403', 'kafka:publish-429', 'kafka:stream-503', 'kafka:stream-401', 'kafka:stream-no-session', 'kafka:stream-dropped',
 ...['detail', 'access', 'metadata'].map((section) => `kafka:topic-${section}-replay-401`),
]
export const parityDifferences = ['Per-section retry', 'Request IDs in error panels', 'Loading skeletons', '403 no-access and 404 back-link states', 'Empty status timeline', 'Quota meter', 'English locale']
const manifest: ParityManifest = {
 route: '/console/kafka', roles: ['tenant_owner', 'tenant_viewer', 'superadmin'], fixtures: fixtureNames,
 sources: ['src/pages/consoleKafka.tsx', 'src/pages/consoleKafka'],
 endpoints: {}, data: [{ name: 'topic name', locator: 'button:text-is("orders.created")' }], actions: [], states: [],
}
export default manifest

// J03 fixtures from legacy e2e/fixtures/service-e2e.ts:210-281, without changing their data.
export const legacyJourneyFixtures = {
 inventory: { workspaceId: 'ws_alpha_prod', tenantId: 'tenant_alpha', items: [{ resourceId: 'topic_audit_001', topicId: 'topic_audit_001', topicName: 'platform.audit.events', status: 'active', state: 'active', partitions: 3, partitionCount: 3, replicationFactor: 1 }], counts: { total: 1, topics: 1 }, bridges: [] },
 empty: { workspaceId: 'ws_alpha_prod', tenantId: 'tenant_alpha', items: [], counts: { total: 0, topics: 0 }, bridges: [] },
 detail: { resourceId: 'topic_audit_001', topicId: 'topic_audit_001', topicName: 'platform.audit.events', status: 'active', partitionCount: 3, replicationFactor: 1, retentionHours: 168, workspaceId: 'ws_alpha_prod', tenantId: 'tenant_alpha' },
 access: { resourceId: 'topic_audit_001', topicName: 'platform.audit.events', aclBindings: [{ principal: 'ws_alpha_owner', operations: ['read', 'write'], state: 'active' }] },
 metadata: { resourceId: 'topic_audit_001', lag: { totalLag: 0, maxPartitionLag: 0 }, retention: { retentionHours: 168, retentionMs: 604800000 }, compaction: { enabled: false }, health: 'healthy' },
}
