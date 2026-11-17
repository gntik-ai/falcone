import { Text } from '@gntik-ai/ui'
import { SectionHeader } from '@gntik-ai/blocks'
import type { FunctionAction } from './api'
import { formatEnumLabel, formatValue, useCopy } from './copy'
import { Empty } from './States'

export function TriggersTab({ action }: { action: FunctionAction | null }) {
  const { t } = useCopy()
  const kafka = action?.kafkaTriggers ?? []
  const cron = action?.cronTriggers ?? []
  const storage = action?.storageTriggers ?? []
  const group = (title: string, lines: { key: string; text: string }[]) => lines.length === 0 ? null : <section key={title} aria-label={title} className="min-w-0 space-y-2">
    <SectionHeader title={title} description={null} count={undefined} actions={[]} as="h3" bordered={false} headingId={undefined} className="min-w-0" />
    <ul className="min-w-0 space-y-2">{lines.map((line) => <li key={line.key} className="rounded-md border border-border p-3 text-sm leading-6 break-words"><Text as="span" variant="body" tone="default" className="font-mono text-xs">{line.text}</Text></li>)}</ul>
  </section>
  return <div className="min-w-0 space-y-4" data-testid="functions-triggers">
    {!kafka.length && !cron.length && !storage.length && <Empty title={t('triggers.empty')} />}
    {group(t('triggers.kafka'), kafka.map((item, index) => ({ key: item.triggerId ?? item.topicRef ?? String(index), text: t('triggers.kafkaItem', { name: item.topicRef ?? item.triggerId, mode: formatEnumLabel(item.deliveryMode), status: formatEnumLabel(item.status) }) })))}
    {group(t('triggers.cron'), cron.map((item, index) => ({ key: item.triggerId ?? item.schedule ?? String(index), text: t('triggers.cronItem', { name: item.schedule ?? item.triggerId, timezone: formatValue(t, item.timezone), status: formatEnumLabel(item.status) }) })))}
    {group(t('triggers.storage'), storage.map((item, index) => ({ key: item.triggerId ?? item.bucketRef ?? String(index), text: t('triggers.storageItem', { name: item.bucketRef ?? item.triggerId, events: item.eventTypes?.join(', ') || '—', status: formatEnumLabel(item.status) }) })))}
  </div>
}
