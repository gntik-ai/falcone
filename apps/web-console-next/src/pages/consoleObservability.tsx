import { useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { EmptyState, I18nProvider, Link, LiveAnnouncer, Page, StatusTag, Text } from '@gntik-ai/ui'
import { PageHeader, TableSkeleton, type PageHeaderTab } from '@gntik-ai/blocks'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import i18n from '../i18n'
import { useConsoleContext } from '../shell/context'
import { useSession } from '../shell/session'
import { AuditPanel } from './consoleObservability/Audit'
import { MetricsPanel } from './consoleObservability/Metrics'
import { emptyFilters, type AuditFilters, type MetricWindow, type Scope } from './consoleObservability/api'
import { scopeKey, useAudit, useExport, useMetrics } from './consoleObservability/hooks'
import es from '../locales/es/pages.console-observability-page.json'
import en from '../locales/en/pages.console-observability-page.json'

i18n.addResourceBundle('es', 'pages.console-observability-page', es)
i18n.addResourceBundle('en', 'pages.console-observability-page', en)

const postureTone = (posture: string) => posture.includes('breach') || posture.includes('exceeded') ? 'destructive' as const : posture.includes('warning') ? 'warning' as const : posture === 'within_limit' ? 'success' as const : 'neutral' as const

function Observability() {
  const { t } = useTranslation('pages.console-observability-page')
  const { activeTenantId, activeWorkspaceId, tenants, workspaces, loading } = useConsoleContext()
  const roles = useSession()?.principal?.platformRoles
  // Issue 761: tenant_developer is denied tenant.audit.read, so it gets no Auditoria tab and no audit request.
  const canReadAudit = getConsolePermissions(roles).can('tenant.audit.read')
  const [tab, setTab] = useState<'metrics' | 'audit'>('metrics')
  const [window, setWindow] = useState<MetricWindow>('24h')
  const [filters, setFilters] = useState<AuditFilters>(emptyFilters)
  const scope = useMemo<Scope | null>(() => activeTenantId ? { tenantId: activeTenantId, workspaceId: activeWorkspaceId } : null, [activeTenantId, activeWorkspaceId])
  const auditScope = canReadAudit ? scope : null
  const metrics = useMetrics(scope, window)
  const audit = useAudit(auditScope, filters)
  const exporter = useExport(auditScope, filters)
  const key = scopeKey(scope)
  const active = tab === 'audit' && canReadAudit ? 'audit' : 'metrics'
  const tenantLabel = tenants.find((tenant) => tenant.tenantId === activeTenantId)?.displayName
  const workspaceLabel = workspaces.find((workspace) => workspace.workspaceId === activeWorkspaceId)?.displayName
  const context = [tenantLabel, workspaceLabel].filter(Boolean).join(' · ') || t('activeTenant')
  const view = metrics.data?.status === 'ready' ? metrics.data.view : null
  const posture = view ? view.overallPosture ?? 'unknown' : null
  const postureLabel = posture === null ? '' : Object.hasOwn(es.posture, posture) ? t(`posture.${posture}`) : posture.replace(/_/g, ' ')
  const tabs: PageHeaderTab[] = [{ value: 'metrics', label: t('tabMetrics') }, ...(canReadAudit ? [{ value: 'audit', label: t('tabAudit') }] : [])]
  const header = <PageHeader as="div" wrapTitle={true} title={t('title')} description={context} breadcrumbs={null} status="" statuses={{}} actions={[]}
    meta={posture === null ? [] : [{ label: t('postureLabel'), mono: false, value:
      <Link render={<RouterLink to="/console/quotas" />} underline="always" external={false} externalLabel="" aria-label={t('postureLink', { label: postureLabel })} className="inline-flex items-center gap-1">
        <StatusTag status={posture} label={postureLabel} statuses={{ [posture]: { label: postureLabel, tone: postureTone(posture) } }} uppercase={false} /><ArrowRight aria-hidden={true} className="size-3" />
      </Link> }]}
    tabs={tabs} tab={active} defaultTab={undefined} onTabChange={(value) => setTab(value === 'audit' ? 'audit' : 'metrics')}
    labels={{ title: t('title'), description: context, moreActions: t('actions'), sections: t('tabsLabel') }} />
  return <Page width="wide" header={header} title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="console-observability min-w-0 space-y-6 wrap-anywhere">
    {loading ? <section role="status" aria-busy={true} aria-label={t('metrics.loading')}><Text>{t('metrics.loadingDescription')}</Text>
        <div aria-hidden={true}><TableSkeleton rows={4} columns={2} label={t('metrics.loading')} className="min-w-0" /></div></section>
      : !scope ? <EmptyState title={t('blocked')} description={t('blockedDescription')} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h2" bordered={false} />
      : active === 'audit' ? <AuditPanel key={key} filters={filters} onFilters={setFilters} audit={audit} exporter={exporter} />
      : <MetricsPanel key={key} scope={scope} window={window} onWindow={setWindow} metrics={metrics} />}
  </Page>
}
export default function ConsoleObservabilityPage() {
  const { i18n: language } = useTranslation('pages.console-observability-page')
  return <I18nProvider locale={language.language}><LiveAnnouncer><Observability /></LiveAnnouncer></I18nProvider>
}
