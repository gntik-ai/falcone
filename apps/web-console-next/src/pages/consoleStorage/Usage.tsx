import { Meter, Text } from '@gntik-ai/ui'
import { KpiRow } from '@gntik-ai/blocks'
import type { StorageState } from './useStorage'
import { bytes, relativeDate, useCopy } from './copy'
import { Details, Table, Notice } from './States'
export function Usage({ state: s }: { state: StorageState }) {
  const { t } = useCopy()
  const data = s.usage.data!
  const unavailable = data.collectionStatus === 'provider_unavailable'
  const snapshot = data.cacheSnapshotAt ?? data.snapshotAt
  const age = snapshot && Number.isFinite(Date.parse(snapshot)) ? Math.max(0, Math.round((Date.now() - Date.parse(snapshot)) / 60000)) : null
  const dim = data.dimensions
  const percent = dim?.totalBytes?.utilizationPercent
  const limit = dim?.totalBytes?.limit
  const value = (input: unknown) => input == null ? t('none') : String(input)
  const enumValue = (input?: string) => input ? t(`enums.${input}`, { defaultValue: input.replace(/_/g, ' ') }) : t('none')
  const snapshotLabel = relativeDate(snapshot, t)
  const names = new Map(s.buckets.data?.items.map((item) => [item.resourceId, item.bucketName]))
  return <div className="min-w-0 space-y-4">
    {unavailable && <Notice tone="warning">{t('providerUnavailable')}</Notice>}
    {age != null && age > 15 && <Notice tone="warning">{t('stale', { count: age })}</Notice>}
    <KpiRow items={['totalBytes', 'objectCount', 'bucketCount'].map((id) => ({ id, label: t(id), value: unavailable ? t('none') : id === 'totalBytes' ? bytes(dim?.totalBytes?.used) ?? t('none') : value(dim?.[id as 'objectCount' | 'bucketCount']?.used), delta: undefined, trend: [], trendTone: undefined }))} variant="strip" showTrends={false} label={t('usage')} className="min-w-0" />
    <Details title={t('snapshot')} items={[{ id: 'method', label: t('collectionMethod'), value: enumValue(data.collectionMethod) }, { id: 'status', label: t('collectionStatus'), value: enumValue(data.collectionStatus) }, { id: 'snapshot', label: t('snapshot'), value: snapshotLabel }]} />
    {!unavailable && (typeof percent === 'number' && typeof limit === 'number' ? <Meter value={percent} min={0} max={100} size="md" label={t('quota')} valueLabel={t('quotaValue', { percent: Math.round(percent), used: bytes(dim?.totalBytes?.used) ?? t('none'), limit: bytes(limit) })} hideValue={false} thresholds={{ warning: 75, destructive: 90 }} higherIsBetter={false} note={null} className="min-w-0" /> : <Text as="p" variant="supporting" tone="muted">{t('noQuota')}</Text>)}
    {!unavailable && (data.buckets?.length ? <Table rows={data.buckets} id={(row) => row.bucketId} label={t('breakdown')} columns={[
      { id: 'bucket', header: t('bucket'), sortable: false, cell: (row) => names.get(row.bucketId) ?? row.bucketId },
      { id: 'volume', header: t('volume'), sortable: false, cell: (row) => bytes(row.totalBytes) ?? t('none') },
      { id: 'objects', header: t('objects'), sortable: false, cell: (row) => value(row.objectCount) },
      { id: 'largest', header: t('largest'), sortable: false, cell: (row) => bytes(row.largestObjectSizeBytes) ?? t('none') },
    ]} /> : <Text as="p" variant="supporting" tone="muted">{t('noBreakdown')}</Text>)}
  </div>
}
