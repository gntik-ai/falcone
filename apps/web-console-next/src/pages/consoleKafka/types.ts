export type KafkaNamingPolicy = {
  topicPrefix?: string
  physicalTopicPattern?: string
  topicNameGovernance?: string
  maxTopicNameLength?: number
  consumerGroupPrefix?: string
  serviceAccountPrincipalPrefix?: string
  userProvidedPhysicalNamesAllowed?: boolean
}

export type KafkaTenantIsolation = {
  mode?: string
  topicPrefix?: string
  consumerGroupPrefix?: string
  aclPatternType?: string
  workspacePrincipalPrefix?: string
  workspacePrincipalCount?: number
  crossTenantAccessPrevented?: boolean
}

export type KafkaQuotaStatus = {
  metricKey?: string
  limit?: number
  used?: number
  remaining?: number
  enforcementMode?: string
  maxPartitionsPerTopic?: number
  maxPublishesPerSecond?: number
  maxConcurrentSubscriptions?: number
  maxReplayBatchSize?: number
  maxNotificationQueueDepth?: number
  visibleInConsole?: boolean
}

export type KafkaTopicInventoryItem = {
  resourceId: string
  topicName: string
  physicalTopicName?: string
  status?: string
  provisioning?: { state?: string; failureClass?: string; gatingMode?: string }
  cleanupPolicy?: string
  partitionCount?: number
  retentionHours?: number
  quotaStatus?: KafkaQuotaStatus
  operationalMetadata?: { bridgeCount?: number; bridgeIds?: string[] }
}

export type KafkaInventory = {
  workspaceId: string
  tenantId: string
  brokerMode?: string
  isolationMode?: string
  items: KafkaTopicInventoryItem[]
  counts?: { total?: number; active?: number; provisioning?: number; degraded?: number; topics?: number; aclBindings?: number; serviceAccounts?: number }
  namingPolicy?: KafkaNamingPolicy
  quotaStatus?: KafkaQuotaStatus
  tenantIsolation?: KafkaTenantIsolation
  observedAt?: string
  snapshotId?: string
  auditCoverage?: { mode?: string; retentionDays?: number }
  bridgeIds?: string[]
}

export type KafkaTopicDetail = {
  resourceId: string
  topicName: string
  physicalTopicName?: string
  channelPrefix?: string
  partitionCount?: number
  replicationFactor?: number
  retentionHours?: number
  cleanupPolicy?: string
  deliverySemantics?: string
  partitionStrategy?: string
  partitionSelectionPolicy?: string
  replayWindowHours?: number
  maxPublishesPerSecond?: number
  maxConcurrentSubscriptions?: number
  status?: string
  auditMode?: string
  allowedTransports?: string[]
  provisioning?: { state?: string; failureClass?: string }
  quotaStatus?: KafkaQuotaStatus
  tenantIsolation?: KafkaTenantIsolation
  namingPolicy?: KafkaNamingPolicy
  payloadPolicy?: { maxPayloadBytes?: number; compressionHint?: string; schemaValidation?: string }
  replayPolicy?: { enabled?: boolean; storageBackend?: string; maxReplayWindowHours?: number }
  notificationPolicy?: { queuesEnabled?: boolean; maxQueueDepth?: number; retentionHours?: number }
  operationalMetadata?: { bridgeCount?: number; functionTriggerCount?: number; sampledAt?: string; visibleFields?: string[] }
  timestamps?: { createdAt?: string; updatedAt?: string }
  tenantId?: string
  workspaceId?: string
}

export type KafkaAclBinding = {
  principal: string
  serviceAccountId?: string
  resourceType?: string
  resourceName?: string
  patternType?: string
  operations?: string[]
  permission?: string
  consumerGroupPrefix?: string
  workspaceScoped?: boolean
}

export type KafkaAccessPolicy = {
  resourceId: string
  topicName: string
  physicalTopicName?: string
  aclBindings: KafkaAclBinding[]
  auditMode?: string
  providerCompatibility?: { provider?: string; nativeAclSupport?: boolean; managedPrincipals?: boolean }
  provisioning?: { state?: string }
  quotaStatus?: KafkaQuotaStatus
  tenantIsolation?: KafkaTenantIsolation
}

export type KafkaPartitionMeta = Record<string, {
  lag?: number
  logStartOffset?: number
  logEndOffset?: number
  replicaCount?: number
  leader?: number
  inSync?: boolean
}>

export type KafkaMetadata = {
  resourceId: string
  sampledAt?: string
  lag?: { consumerGroupId?: string; totalLag?: number; maxPartitionLag?: number; isActive?: boolean; available?: boolean; maxMessagesBehind?: number; p95Ms?: number; observedAt?: string }
  retention?: { retentionHours?: number; retentionBytes?: number; effectivePolicy?: string; available?: boolean; hours?: number; retentionMs?: number; replayWindowHours?: number }
  compaction?: { enabled?: boolean; lastCompactionTimestamp?: string; compactionLag?: number; available?: boolean; cleanupPolicy?: string; reason?: string }
  partitionMetadata?: KafkaPartitionMeta | { available?: boolean; partitionCount?: number; partitionKeysExposed?: boolean; reason?: string }
  technicalLimitations?: Array<{ code?: string; description?: string; affectedField?: string } | string>
}

export type KafkaBridgeSource = {
  sourceType?: string
  sourceRef?: string
  workspaceId?: string
}

export type KafkaBridge = {
  bridgeId: string
  topicRef: string
  status: string
  source?: KafkaBridgeSource
  delivery?: { mode?: string; guarantees?: string; retryPolicy?: string }
  audit?: { enabled?: boolean; retentionDays?: number; maskFields?: string[]; mode?: string }
  timestamps?: { createdAt?: string; updatedAt?: string }
}

export type KafkaPublishRequest = {
  payload: unknown
  eventType?: string
  key?: string
  contentType?: string
}

export type KafkaPublishAccepted = {
  publicationId: string
  status: string
  acceptedAt?: string
  topicName?: string
  acceptedPartition?: number
  key?: string
  payloadSizeBytes?: number
  deliverySemantics?: string
  auditRecordId?: string
  correlationId?: string
}

export type KafkaStreamEvent = {
  receivedAt: string
  raw: string
  key?: string
  eventType?: string
  payload?: unknown
}
