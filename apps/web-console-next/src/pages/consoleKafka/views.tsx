import { Badge, Meter } from '@gntik-ai/ui'
import { StatusTimeline } from '@gntik-ai/blocks'
import type { KafkaTopicDetail, KafkaAccessPolicy, KafkaMetadata, KafkaPartitionMeta } from './types'
import { useCopy, useFormat } from './copy'
import { Empty, Grid, Heading, Muted, Notice, Status, Values } from './parts'
export function Detail({ data }: { data: KafkaTopicDetail }) {
 const { t } = useCopy(), { formatCleanupPolicy, formatDeliverySemantics, formatEnumLabel } = useFormat()
 return <div className="min-w-0 space-y-5">
<Values title={t('identification')} items={[
                          { label: t('topicName'), value: data.topicName },
                          { label: t('physicalTopicName'), value: data.physicalTopicName },
                          { label: t('channelPrefix'), value: data.channelPrefix },
                          { label: t('resourceId'), value: data.resourceId }
                        ]} />
<Values title={t('configuration')} items={[
                          { label: t('partitions'), value: data.partitionCount },
                          { label: t('replicationFactor'), value: data.replicationFactor },
                          { label: t('retentionHoursDetail'), value: data.retentionHours },
                          { label: t('cleanupPolicyDetail'), value: formatCleanupPolicy(data.cleanupPolicy) },
                          { label: t('deliverySemantics'), value: formatDeliverySemantics(data.deliverySemantics) },
                          { label: t('partitionStrategy'), value: formatEnumLabel(data.partitionStrategy) },
                          { label: t('replayWindowHours'), value: data.replayWindowHours }
                        ]} />
<Values title={t('policies')} items={[
                          { label: t('replayEnabled'), value: data.replayPolicy?.enabled },
                          { label: t('replayService'), value: data.replayPolicy?.storageBackend },
                          { label: t('maximumReplayWindow'), value: data.replayPolicy?.maxReplayWindowHours },
                          { label: t('maximumPayloadBytes'), value: data.payloadPolicy?.maxPayloadBytes },
                          { label: t('compression'), value: data.payloadPolicy?.compressionHint },
                          { label: t('schemaValidation'), value: data.payloadPolicy?.schemaValidation },
                          { label: t('queuesEnabled'), value: data.notificationPolicy?.queuesEnabled },
                          { label: t('maximumQueueDepth'), value: data.notificationPolicy?.maxQueueDepth },
                          { label: t('notificationRetention'), value: data.notificationPolicy?.retentionHours }
                        ]} />
<Values raw={true} title={t('transports')} items={[{ label: t('transports'), value: data.allowedTransports?.length ? data.allowedTransports.join(', ') : t('missingValueLabel') }]} />
<Values title={t('quotas')} items={[
 { label: t('limit'), value: data.quotaStatus?.limit }, { label: t('used'), value: data.quotaStatus?.used }, { label: t('remaining'), value: data.quotaStatus?.remaining },
 { label: t('limitEnforcement'), value: data.quotaStatus?.enforcementMode }, { label: t('publishesS'), value: data.quotaStatus?.maxPublishesPerSecond ?? data.maxPublishesPerSecond }, { label: t('subscriptions'), value: data.quotaStatus?.maxConcurrentSubscriptions ?? data.maxConcurrentSubscriptions }
]} />
{typeof data.quotaStatus?.limit === 'number' && data.quotaStatus.limit > 0 && typeof data.quotaStatus.used === 'number' ? <Meter value={data.quotaStatus.used} min={0} max={data.quotaStatus.limit} size="md" label={t('quotas')} valueLabel={`${data.quotaStatus.used} / ${data.quotaStatus.limit}`} hideValue={false} thresholds={{ warning: 80, destructive: 100 }} higherIsBetter={false} note={null} className="min-w-0" /> : null}
<Values title={t('organizationIsolation')} items={[
                          { label: t('mode'), value: data.tenantIsolation?.mode },
                          { label: t('topicPrefix'), value: data.tenantIsolation?.topicPrefix },
                          { label: t('consumerGroupPrefix'), value: data.tenantIsolation?.consumerGroupPrefix },
                          { label: t('crossOrganizationAccessPrevented'), value: data.tenantIsolation?.crossTenantAccessPrevented }
                        ]} />
<Values title={t('timestamps')} items={[
                          { label: t('createdAt'), value: data.timestamps?.createdAt },
                          { label: t('updatedAt'), value: data.timestamps?.updatedAt }
                        ]} />
<StatusTimeline events={[]} label={t('statusHistory')} emptyLabel={t('noStatusHistory')} showFewerLabel={t('showFewer')} showEarlierLabel={() => t('showEarlier')} actorLabel={t('by')} maxVisible={0} timeFormat="absolute" className="min-w-0" />
</div>
}
export function Access({ data }: { data: KafkaAccessPolicy }) {
 const { t } = useCopy(), { formatValue } = useFormat()
 return <div className="min-w-0 space-y-4">
 <Values title={t('access')} items={[{ label: t('auditMode'), value: data.auditMode }, { label: t('provider'), value: data.providerCompatibility?.provider }, { label: t('nativeAclSupport'), value: data.providerCompatibility?.nativeAclSupport }]} />
 {data.aclBindings.length ? <Grid rows={data.aclBindings} id={(row) => `${row.principal}-${data.aclBindings.indexOf(row)}`} label={t('access')} columns={[
 { id: 'principal', header: t('principal'), cell: (row) => row.principal }, { id: 'operations', header: t('operations'), cell: (row) => row.operations?.join(', ') || t('missingValueLabel') },
 { id: 'permission', header: t('permission'), cell: (row) => <Status value={row.permission} /> }, { id: 'pattern', header: t('type'), cell: (row) => formatValue(row.patternType) }, { id: 'resource', header: t('resource'), cell: (row) => row.resourceName || t('missingValueLabel') }, { id: 'workspace', header: t('workspaceScoped'), cell: (row) => formatValue(row.workspaceScoped) }
 ]} /> : <Empty title={t('thereAreNoConfiguredAclBindings')} />}
 </div>
}
export function Metadata({ data }: { data: KafkaMetadata }) {
 const { t } = useCopy(), { formatValue, formatRelativeDate, lagTone } = useFormat()
 const lag = lagTone(data.lag?.totalLag)
 return <div className="min-w-0 space-y-5">
 <Muted><Badge tone={lag.tone} variant="soft" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{lag.label}</Badge> {t('separator')} {t('sampled')} {formatRelativeDate(data.sampledAt)}</Muted>
<Values title={t('lag')} items={[
                          { label: t('totalLag'), value: data.lag?.totalLag },
                          { label: t('maximumPartitionLag'), value: data.lag?.maxPartitionLag },
                          { label: t('consumerGroup'), value: data.lag?.consumerGroupId },
                          { label: t('activeLabel'), value: data.lag?.isActive ?? data.lag?.available }
                        ]} />
<Values title={t('effectiveRetention')} items={[
                          { label: t('retentionHours'), value: data.retention?.retentionHours },
                          { label: t('retentionBytes'), value: data.retention?.retentionBytes },
                          { label: t('effectivePolicy'), value: data.retention?.effectivePolicy }
                        ]} />
<Values title={t('compaction')} items={[
                          { label: t('enabledStatus'), value: data.compaction?.enabled ?? data.compaction?.available },
                          { label: t('lastCompaction'), value: data.compaction?.lastCompactionTimestamp },
                          { label: t('compactionLag'), value: data.compaction?.compactionLag }
                        ]} />
{data.partitionMetadata && !('available' in data.partitionMetadata) ? <section className="min-w-0 space-y-3"><Heading title={t('partitions')} level="h3" /><Grid rows={Object.entries(data.partitionMetadata as KafkaPartitionMeta).map(([partition, row]) => ({ partition, ...row }))} id={(row) => row.partition} label={t('partitions')} columns={[
 { id: 'partition', header: t('partition'), cell: (row) => row.partition }, { id: 'lag', header: t('lagAmount'), cell: (row) => formatValue(row.lag) }, { id: 'start', header: t('startOffset'), cell: (row) => formatValue(row.logStartOffset) }, { id: 'end', header: t('endOffset'), cell: (row) => formatValue(row.logEndOffset) }, { id: 'sync', header: t('inSync'), cell: (row) => formatValue(row.inSync) }
 ]} /></section> : null}
 {data.technicalLimitations?.length ? <section className="space-y-2"><Heading title={t('technicalLimitations')} level="h3" />{data.technicalLimitations.map((limitation, index) => <Notice key={index}>{typeof limitation === 'string' ? limitation : <>{limitation.code ?? t('limitation')}{t('colon')} {limitation.description ?? limitation.affectedField ?? t('noDescription')}</>}</Notice>)}</section> : null}
 </div>
}
