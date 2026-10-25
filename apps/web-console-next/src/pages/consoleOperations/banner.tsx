import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { InlineCallout } from '@gntik-ai/blocks'
import type { TFunction } from 'i18next'
import type { ReconciliationDelta } from './reconcile-operations.runtime.mjs'

export function summarizeDelta(delta: ReconciliationDelta | null, t: TFunction): string {
  if (!delta) return ''
  const parts: string[] = []
  const counts = new Map<string, number>()
  for (const item of delta.terminal) counts.set(item.status, (counts.get(item.status) ?? 0) + 1)
  if (counts.size) parts.push(t('delta.terminal', { summary: Array.from(counts, ([status, count]) => t(`delta.${status}`, { count })).join(', ') }))
  if (delta.unavailable.length) parts.push(t('delta.unavailable', { count: delta.unavailable.length }))
  if (!parts.length && delta.added.length) parts.push(t('delta.added', { count: delta.added.length }))
  return parts.join(' ')
}
export function OperationStatusBanner({ delta, onDismiss, onClose }: { delta: ReconciliationDelta | null; onDismiss: () => void; onClose: () => void }) {
  const { t } = useTranslation('pages.console-operations-page')
  const summary = summarizeDelta(delta, t)
  useEffect(() => {
    if (!summary) return
    const timer = window.setTimeout(onDismiss, 30_000)
    return () => window.clearTimeout(timer)
  }, [delta, summary, onDismiss])
  if (!summary) return null
  return <InlineCallout tone="info" title={summary} description={null} icon={null}
    labels={{ title: summary, description: '', upgrade: '', viewUsage: '' }}
    actions={[{ label: t('dismiss'), variant: 'ghost', onClick: onClose }]} dismissible={false} open={true} onDismiss={undefined} />
}
