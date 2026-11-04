import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { EmptyState, Link, StatusTag, Text, Timestamp } from '@gntik-ai/ui'
import { DescriptionListCard, StatusTimeline } from '@gntik-ai/blocks'
import { isMigratedRoute } from '../../shell/navigation'
import type { PlanRecord } from './api'
import { statusTones } from './model'

const NAMESPACE = 'pages.console-plan-detail-page'
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'

export function usePlanStatuses() {
  const { t } = useTranslation(NAMESPACE)
  return Object.fromEntries((['draft', 'active', 'deprecated', 'archived'] as const).map((status) => [status, { label: t(`status.${status}`), tone: statusTones[status] }]))
}

export function InfoPanel({ plan, count, locale }: { plan: PlanRecord; count: number | null; locale: string }) {
  const { t } = useTranslation(NAMESPACE)
  const statuses = usePlanStatuses()
  const description = plan.description?.trim()
  const date = plan.updatedAt
    ? <Timestamp value={plan.updatedAt} locale={locale} format="absolute" live={false} tooltip={false} fallback={t('info.noDate')} dateOptions={{ dateStyle: 'medium', timeStyle: 'short' }} />
    : t('info.noDate')
  const items = [
    { id: 'state', label: t('info.state'), render: <StatusTag status={plan.status} label={t(`status.${plan.status}`)} statuses={statuses} uppercase={false} />, mono: false, copyable: false },
    { id: 'assignments', label: t('info.assignments'), render: <span>{count ?? t('info.unavailable')}</span>, mono: false, copyable: false },
    { id: 'updated', label: t('info.updated'), render: <span className="wrap-anywhere">{date}</span>, mono: false, copyable: false },
    { id: 'description', label: t('info.description'), render: <span className="wrap-anywhere">{description || t('info.noDescription')}</span>, mono: false, copyable: false },
  ]
  // Exactly one entry: no endpoint returns the history, so none is inferred (gap-b003-plan-lifecycle-history).
  const events = [{ id: 'current', status: t(`status.${plan.status}`), tone: statusTones[plan.status] === 'success' ? 'success' as const : statusTones[plan.status] === 'warning' ? 'warning' as const : 'neutral' as const,
    title: t('info.timelineEntry'), at: (plan.updatedAt ?? '') as string, live: false }]
  return <div className="min-w-0 space-y-6">
    <DescriptionListCard title={t('info.title')} description="" items={items} wrap={true} columns={2} titleAs="h2" onEdit={undefined} onCopy={undefined} editLabel="" className="min-w-0"
      labels={{ title: t('info.title'), description: '', edit: '', copy: () => '', copied: () => '', copiedToClipboard: '' }} />
    <section aria-labelledby="plan-timeline-heading" className="min-w-0 space-y-3">
      <h2 id="plan-timeline-heading" className="text-sm font-semibold">{t('info.timeline')}</h2>
      <StatusTimeline events={events} label={t('info.timeline')} emptyLabel={t('info.timeline')} showFewerLabel="" showEarlierLabel={() => ''} actorLabel="" maxVisible={undefined} timeFormat="absolute" />
    </section>
  </div>
}

export function CapabilitiesPanel({ plan }: { plan: PlanRecord }) {
  const { t } = useTranslation(NAMESPACE)
  const entries = Object.entries(plan.capabilities ?? {})
  const states = { enabled: { label: t('capabilities.enabled'), tone: 'success' as const }, blocked: { label: t('capabilities.blocked'), tone: 'neutral' as const } }
  return <div className="min-w-0 space-y-4">
    <div className="space-y-1"><h2 className="text-sm font-semibold">{t('capabilities.title')}</h2><Text variant="supporting" tone="muted">{t('capabilities.help')}</Text></div>
    {entries.length ? <ul aria-label={t('capabilities.list')} className="divide-y divide-border">
      {entries.map(([key, enabled]) => {
        const state = enabled ? 'enabled' : 'blocked'
        return <li key={key} className="flex min-w-0 items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
          <span className="min-w-0 break-words text-sm font-medium">{key}</span>
          <StatusTag status={state} label={states[state].label} statuses={states} uppercase={false} aria-label={t('capabilities.itemName', { key, state: states[state].label })} />
        </li>
      })}
    </ul> : <EmptyState title={t('capabilities.emptyTitle')} description={t('capabilities.emptyDescription')} titleAs="h3" bordered={true} primaryAction={null} secondaryAction={null} />}
  </div>
}

export function AssignmentsPanel({ summary }: { summary: string }) {
  const { t } = useTranslation(NAMESPACE)
  const href = '/console/tenants'
  return <div className="min-w-0 space-y-3">
    <h2 className="text-sm font-semibold">{t('assignments.title')}</h2>
    <Text>{summary}</Text>
    <Text variant="supporting" tone="muted">{t('assignments.help')}</Text>
    {isMigratedRoute(href)
      ? <RouterLink to={href} state={{ focusMainHeading: true }} className={`inline-block underline ${focus}`}>{t('assignments.open')}</RouterLink>
      : <Link href={href} underline="always" external={false} externalLabel="">{t('assignments.open')}</Link>}
  </div>
}
