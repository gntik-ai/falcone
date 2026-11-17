// Node detail for the run view (ported from the legacy RunNodeDetailPanel onto kit components).
//
// Entrada and Salida are code-blocks holding the page-computed text, capped for display only.
// A cut payload is no longer valid JSON, which is why this is not a json-viewer.
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, CodeBlock, Heading, ScrollArea, StatusTag, Text, VisuallyHidden } from '@gntik-ai/ui'
import { StatusTimeline, type StatusEvent } from '@gntik-ai/blocks'
import type { JsonValue } from '@in-falcone/console-api/http'
import type { ExecutionNodeDetail } from './api'
import { RunButton as Button } from './controls'
import { attemptDotTones, formatDuration, nodeStatusTones, renderCappedPayload, type NodeStatusSnapshot } from './status'

export const inspectorHeadingId = 'run-inspector-heading'
// The muted placeholder for an absent payload; its accessible text is translated.
const emptyMark = '\u2014'

function PayloadBlock({ name, id, value }: { name: string; id: 'entrada' | 'salida'; value: JsonValue | null | undefined }) {
  const { t } = useTranslation('pages.console-flow-run-page')
  const { text, truncated } = renderCappedPayload(value)
  return <section className="space-y-2" data-testid={`run-node-payload-${id}`} aria-label={name}>
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <Heading level={3} size="2xs" tone="muted">{name}</Heading>
      {truncated && <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="" data-testid={`run-node-${id}-truncated`}>{t('truncated')}</Badge>}
    </div>
    {text
      ? <CodeBlock code={text} language={undefined} filename={undefined} showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={true} maxHeight={192} highlight={undefined}
        label={truncated ? t('payloadTruncated', { name }) : t('payloadNamed', { name })} className="min-w-0" />
      : <Text variant="supporting" tone="muted" data-testid={`run-node-${id}-empty`}><span aria-hidden={true}>{emptyMark}</span><VisuallyHidden focusable={false}>{t('payloadEmpty', { name })}</VisuallyHidden></Text>}
  </section>
}

export function Inspector({ nodeId, detail, liveStatus, onClose }: { nodeId: string; detail: ExecutionNodeDetail | null; liveStatus: NodeStatusSnapshot | null; onClose: () => void }) {
  const { t } = useTranslation('pages.console-flow-run-page')
  const status = liveStatus?.status ?? detail?.status ?? null
  const error = liveStatus?.error ?? detail?.error ?? null
  const attempts = detail?.attempts ?? []
  const duration = liveStatus ? formatDuration(liveStatus.startedAt, liveStatus.completedAt) : null
  const statusDetail = [liveStatus && liveStatus.attemptNumber > 1 ? t('attemptNumber', { number: liveStatus.attemptNumber }) : '', duration ?? ''].filter(Boolean).join(' · ')
  const events: StatusEvent[] = attempts.map((attempt, index) => ({
    id: `${attempt.attemptNumber ?? index}-${attempt.startedAt ?? index}`,
    status: t(`nodeStatus.${attempt.status}`, { defaultValue: attempt.status }),
    tone: attemptDotTones[attempt.status] ?? 'neutral',
    title: t('attemptTitle', { number: attempt.attemptNumber ?? index + 1 }),
    at: attempt.completedAt ?? attempt.startedAt ?? '',
  }))
  // Escape closes the inspector. It stays inside this subtree, so it never reaches an alert-dialog.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault(); event.stopPropagation(); onClose()
  }
  return <ScrollArea orientation="vertical" bordered={false} aria-label={t('inspector')} aria-labelledby={undefined} viewportClassName="max-h-full" contentClassName="space-y-4 p-3" viewportRef={undefined} className="h-full min-w-0">
    <div className="min-w-0 space-y-4" data-testid="run-node-detail-panel" onKeyDown={onKeyDown}>
      <header className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <Heading level={2} size="sm" tone="default" id={inspectorHeadingId} tabIndex={-1} title={nodeId} className="wrap-anywhere outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">{nodeId}</Heading>
          {status && <span className="inline-flex flex-wrap items-center gap-1" data-testid="node-status-badge" data-status={status}>
            <StatusTag status={status} label={t(`nodeStatus.${status}`, { defaultValue: status })} statuses={{ [status]: { label: t(`nodeStatus.${status}`, { defaultValue: status }), tone: nodeStatusTones[status] ?? 'neutral' } }} uppercase={false} />
            {statusDetail && <Text variant="caption" tone="muted">{statusDetail}</Text>}
          </span>}
        </div>
        <Button variant="secondary" disabled={false} onClick={onClose} data-testid="run-node-detail-close">{t('close')}</Button>
      </header>
      <PayloadBlock name={t('input')} id="entrada" value={detail?.input ?? null} />
      <PayloadBlock name={t('output')} id="salida" value={detail?.output ?? null} />
      {error && <section className="space-y-2" data-testid="run-node-error" aria-label={t('error')}>
        <Heading level={3} size="2xs" tone="muted">{t('error')}</Heading>
        <Text variant="supporting" tone="destructive" className="wrap-anywhere">{error.message}</Text>
        {error.stack && <CodeBlock code={error.stack} language={undefined} filename={undefined} showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={true} maxHeight={128} highlight={undefined} label={t('stack')} className="min-w-0" />}
      </section>}
      <section className="space-y-2" data-testid="run-node-attempts" aria-label={t('attempts')}>
        <Heading level={3} size="2xs" tone="muted">{t('attempts')}</Heading>
        <StatusTimeline events={events} label={t('attempts')} emptyLabel={t('noAttempts')} showFewerLabel={t('showFewer')} showEarlierLabel={(count) => t('showEarlier', { count })} actorLabel="" maxVisible={undefined} timeFormat="absolute" className="min-w-0" />
      </section>
    </div>
  </ScrollArea>
}
