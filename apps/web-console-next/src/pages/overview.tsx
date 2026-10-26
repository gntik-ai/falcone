import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Card, CardBody, ClickableCard, Collapsible, CollapsiblePanel, CollapsibleTrigger, EmptyState, I18nProvider, Meter, Page } from '@gntik-ai/ui'
import { ErrorPanel, FirstRunEmpty, KpiRow, NoAccessEmpty, PageHeader, SectionHeader, TableSkeleton } from '@gntik-ai/blocks'
import i18n from '../i18n'
import { useConsoleContext } from '../shell/context'
import es from '../locales/es/pages.console-overview-page.json'
import en from '../locales/en/pages.console-overview-page.json'
import { normalizeTenantInventorySummary, summarizeTenantQuotaProfile } from './overview/summary'

i18n.addResourceBundle('es', 'pages.console-overview-page', es)
i18n.addResourceBundle('en', 'pages.console-overview-page', en)

const links = ['workspaces', 'members', 'flows', 'my-plan'] as const
const severities = ['nominal', 'warning', 'blocked'] as const
const counts = ['workspaceCount', 'applicationCount', 'managedResourceCount', 'serviceAccountCount'] as const

function openTenantSwitcher() {
  const switcher = document.querySelector<HTMLSelectElement>('.console-shell select')
  switcher?.focus()
  // Native select pickers are available only during a trusted user activation.
  try { switcher?.showPicker?.() } catch { /* Focus preserves keyboard access. */ }
}

function OverviewContent() {
  const { t, i18n: language } = useTranslation('pages.console-overview-page')
  const context = useConsoleContext()
  const [quotaOpen, setQuotaOpen] = useState(false)
  const [inventoryOpen, setInventoryOpen] = useState(false)
  const tenant = context.tenants.find((item) => item.tenantId === context.activeTenantId)
  // Loading and failure take precedence even if the shell still holds prior data.
  const quota = !context.loading && !context.error ? summarizeTenantQuotaProfile(tenant?.quotaProfile) : null
  const inventory = !context.loading && !context.error ? normalizeTenantInventorySummary(tenant?.inventorySummary) : null
  const count = (value: number) => new Intl.NumberFormat(language.language).format(value)
  const empty = (kind: 'quota' | 'inventory' | 'quotaItems') => <EmptyState title={t(`empty.${kind}.title`)} description={t(`empty.${kind}.description`)}
    titleAs="h3" icon={undefined} size="md" bordered={false} primaryAction={null} secondaryAction={null} children={null} />
  const header = <div className="flex flex-wrap items-start justify-between gap-3">
    <PageHeader as="div" title={t('title')} description={t('description')} wrapTitle={true} titleRef={undefined} breadcrumbs={null} status="" statuses={{}} meta={[]} actions={[]} tabs={null}
      tab={undefined} defaultTab={undefined} onTabChange={undefined}
      labels={{ title: t('title'), description: t('description'), moreActions: t('quick.title'), sections: t('quick.title') }} />
    <Badge variant="soft">{t('badge')}</Badge>
  </div>
  return <Page width="default" header={header} title={null} description={null} actions={null} actionBar={null} actionBarLabel="" className="console-overview min-w-0 wrap-anywhere">
    <section aria-labelledby="overview-quick" className="space-y-4">
      <SectionHeader title={t('quick.title')} description={t('quick.description')} as="h2" headingId="overview-quick" count={undefined} actions={[]} bordered={false} />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {links.map((key) => <ClickableCard key={key} title={t(`quick.${key}.label`)} description={t(`quick.${key}.description`)} href={`/console/${key}`}
          titleAs="h3" icon={null} meta={null} chevron={true} disabled={false} onClick={undefined} children={null} />)}
      </div>
    </section>
    <section className="mt-6 space-y-6 min-w-0" aria-label={t('summaries')} aria-busy={context.loading}>
      {context.loading ? <div className="grid gap-6">
        <div role="status" aria-label={t('loading.quota')}><div aria-hidden="true"><TableSkeleton rows={3} columns={2} label={t('loading.quota')} /></div></div>
        <div role="status" aria-label={t('loading.inventory')}><div aria-hidden="true"><TableSkeleton rows={2} columns={4} label={t('loading.inventory')} /></div></div>
      </div> : context.error?.status === 401 ? null
        : context.error?.status === 403 ? <NoAccessEmpty resource={t('summaries')} owner="" showRequestAccess={false} action={undefined} defaultRequested={false} onRequestAccess={undefined}
          titleAs="h2" bordered={false} labels={{ title: () => t('noAccess.title'), description: () => t('noAccess.description'), request: '', requested: '', sent: '' }} />
        : context.error ? <ErrorPanel icon={undefined} title={t('error.title')} message={t('error.message')} code={context.error.status ?? null} requestId="" details="" onRetry={undefined}
          retrying={false} retryLabel="" secondaryAction={null} titleAs="h2" announce={false} labels={{ title: t('error.title'), message: t('error.message'), support: '', retry: '', retrying: '', retryingStatus: '', requestId: '', copyRequestId: '', copied: '', requestIdCopied: '', details: '' }} />
        : !tenant ? <FirstRunEmpty icon={undefined} title={t('empty.tenant.title')} description={t('empty.tenant.description')} actionLabel={t('empty.tenant.action')} onAction={openTenantSwitcher}
          secondary={null} steps={[]} titleAs="h2" bordered={false} labels={{ title: t('empty.tenant.title'), description: t('empty.tenant.description'), action: t('empty.tenant.action'), guide: '' }} />
        : <>
          <Card data-testid="console-tenant-quota-summary"><CardBody className="space-y-4">
            <SectionHeader title={t('quota.title')} description={t('quota.description')} as="h2" headingId="overview-quota" count={undefined} actions={[]} bordered={false} />
            {quota ? <>
              <div className="flex flex-wrap gap-2">{severities.map((severity) => <Badge key={severity} variant="outline">{t(`quota.total.${severity}`, { total: count(quota.totals[severity]) })}</Badge>)}</div>
              {quota.items.length ? <Collapsible variant="subtle" open={quotaOpen} onOpenChange={setQuotaOpen} disabled={false}>
                <CollapsibleTrigger showChevron={true} className="whitespace-normal text-start">{t('quota.disclosure')}</CollapsibleTrigger>
                <CollapsiblePanel className="space-y-4 pt-4">
                  {quota.items.map((item) => {
                    const usage = t('quota.usage', { used: count(item.used), limit: count(item.limit), remaining: count(item.remaining), utilization: count(item.utilizationPercent), unit: item.unit ? t('quota.unit', { unit: item.unit }) : '' })
                    return <div key={`${item.scope}-${item.metricKey}`} className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{item.metricKey}</span><Badge variant="soft">{t(`quota.severity.${item.severity}`)}</Badge></div>
                      <p className="text-sm text-muted-foreground">{t('quota.scope', { scope: item.scope })}</p>
                      <Meter value={item.utilizationPercent} min={0} max={100} size="md" label={null} aria-label={item.metricKey} valueLabel={usage} aria-valuetext={usage}
                        hideValue={false} thresholds={{ warning: 80, destructive: 100 }} higherIsBetter={false} note={null} />
                    </div>
                  })}
                </CollapsiblePanel>
              </Collapsible> : empty('quotaItems')}
            </> : empty('quota')}
          </CardBody></Card>
          <Card data-testid="console-tenant-inventory-summary"><CardBody className="space-y-4">
            <SectionHeader title={t('inventory.title')} description={t('inventory.description')} as="h2" headingId="overview-inventory" count={undefined} actions={[]} bordered={false} />
            {inventory ? <>
              <KpiRow items={counts.map((key) => ({ id: key, label: t(`inventory.${key}`), value: count(inventory[key]), delta: undefined, trend: undefined, trendTone: undefined }))}
                variant="strip" showTrends={false} label={t('inventory.title')} className="min-w-0 [&_dt]:whitespace-normal [&_dt]:overflow-visible" />
              {inventory.workspaces.length > 0 && <Collapsible variant="subtle" open={inventoryOpen} onOpenChange={setInventoryOpen} disabled={false}>
                <CollapsibleTrigger showChevron={true} className="whitespace-normal text-start">{t('inventory.disclosure')}</CollapsibleTrigger>
                <CollapsiblePanel className="space-y-4 pt-4">{inventory.workspaces.map((workspace) => <div key={workspace.workspaceId} className="min-w-0">
                  <p className="font-medium">{workspace.workspaceSlug}</p>
                  <p className="text-sm text-muted-foreground">{t('inventory.workspace', { applications: count(workspace.applicationCount), serviceAccounts: count(workspace.serviceAccountCount), resources: count(workspace.managedResourceCount) })}</p>
                </div>)}</CollapsiblePanel>
              </Collapsible>}
            </> : empty('inventory')}
          </CardBody></Card>
        </>}
    </section>
  </Page>
}

export default function Overview() {
  const { i18n: language } = useTranslation('pages.console-overview-page')
  return <I18nProvider locale={language.language}><OverviewContent /></I18nProvider>
}
