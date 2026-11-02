import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, I18nProvider, Link, LiveAnnouncer, Page, Tabs, TabsList, TabsPanel, TabsTab, Text, ToastProvider, Toaster, useAnnounce, useToast } from '@gntik-ai/ui'
import { PageHeader, TableSkeleton } from '@gntik-ai/blocks'
import i18n from '../i18n'
import { isMigratedRoute } from '../shell/navigation'
import { AssignmentDialog } from './consoleTenantPlan/AssignmentDialog'
import { FailureSurface } from './consoleTenantPlan/Feedback'
import { History } from './consoleTenantPlan/History'
import { Summary } from './consoleTenantPlan/Summary'
import { getEffectiveEntitlements, getPlanChangeHistory, getTenantPlan, listActivePlans } from './consoleTenantPlan/api'
import { useRemote } from './consoleTenantPlan/remote'
import es from '../locales/es/pages.console-tenant-plan-page.json'
import en from '../locales/en/pages.console-tenant-plan-page.json'
import './consoleTenantPlan/page.css'

i18n.addResourceBundle('es', 'pages.console-tenant-plan-page', es)
i18n.addResourceBundle('en', 'pages.console-tenant-plan-page', en)
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'

function TenantPlan({ tenantId }: { tenantId: string }) {
  const { t, i18n: language } = useTranslation('pages.console-tenant-plan-page')
  const announce = useAnnounce()
  const toast = useToast()
  const [tab, setTab] = useState<'summary' | 'history'>('summary')
  const [historyPage, setHistoryPage] = useState(1)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const known = useRef<boolean | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const summaryTab = useRef<HTMLButtonElement>(null)
  const focusTrigger = useRef(false)
  const focusSummary = useRef(false)

  // The assignment and the entitlements are load-bearing together: either failure replaces the whole summary.
  const core = useRemote(tenantId, async () => {
    const [assignment, entitlements] = await Promise.allSettled([getTenantPlan(tenantId), getEffectiveEntitlements(tenantId)])
    if (assignment.status === 'rejected') throw assignment.reason
    if (entitlements.status === 'rejected') throw entitlements.reason
    return { assignment: assignment.value, entitlements: entitlements.value }
  })
  const history = useRemote(`${tenantId}:${historyPage}`, () => getPlanChangeHistory(tenantId, historyPage))
  const plans = useRemote(tenantId, listActivePlans)
  if (core.data) known.current = Boolean(core.data.assignment.assignment)

  useLayoutEffect(() => {
    if (core.phase === 'ready' && focusTrigger.current) { focusTrigger.current = false; trigger.current?.focus() }
  }, [core.phase])
  useEffect(() => {
    if (tab === 'summary' && focusSummary.current) { focusSummary.current = false; summaryTab.current?.focus() }
  }, [tab])

  const tenantsHref = '/console/tenants'
  const back = isMigratedRoute(tenantsHref)
    ? <RouterLink to={tenantsHref} state={{ focusMainHeading: true }} className={`underline ${focus}`}>{t('tenants')}</RouterLink>
    : <Link href={tenantsHref} underline="always" external={false} externalLabel="">{t('tenants')}</Link>
  const backAction = isMigratedRoute(tenantsHref)
    ? <RouterLink to={tenantsHref} state={{ focusMainHeading: true }} className={`underline ${focus}`}>{t('plan.backToTenants')}</RouterLink>
    : <Link href={tenantsHref} underline="always" external={false} externalLabel="">{t('plan.backToTenants')}</Link>
  const header = <>
    <nav aria-label={t('breadcrumb')} className="flex flex-wrap gap-3 text-sm">{back}<Text as="span" aria-current="page">{t('title')}</Text></nav>
    <PageHeader as="div" wrapTitle={true} title={t('title')} description={t('description')} breadcrumbs={null} status="" statuses={{}} meta={[]} actions={[]} tabs={null}
      labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('tabs') }} />
  </>
  const assigned = (planName: string) => {
    const message = t('assigned', { plan: planName })
    toast.add({ title: message, description: undefined, tone: 'success', priority: 'low' })
    announce(message, 'polite')
    focusTrigger.current = true
    // Refetch so the header never shows the previous plan as current.
    core.refresh()
  }
  const loading = core.phase === 'loading' || core.failure?.status === 401
  const showAction = known.current !== null && core.phase !== 'error'

  return <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} header={header} className="console-tenant-plan min-w-0 space-y-6 wrap-anywhere">
    {showAction && <div className="flex min-w-0 justify-end">
      <Button ref={trigger} type="button" variant="primary" aria-haspopup="dialog" aria-busy={assigning || core.phase !== 'ready'} disabled={assigning || core.phase !== 'ready'} onClick={() => setDialogOpen(true)}>
        {t(known.current ? 'changePlan' : 'assignPlan')}
      </Button>
    </div>}
    {loading ? <section role="status" aria-label={t('loadingPlan')} aria-busy={true}>
      <Text>{t('loadingPlanDescription')}</Text><div aria-hidden={true}><TableSkeleton rows={4} columns={5} label={t('loadingPlan')} className="min-w-0" /></div>
    </section>
      : core.phase === 'error' && core.failure ? <FailureSurface scope="plan" failure={core.failure} retrying={core.retrying} onRetry={core.retry} titleAs="h2" notFoundAction={backAction} />
      : core.data && <Tabs value={tab} defaultValue={undefined} variant="underline" orientation="horizontal" onValueChange={(value) => setTab(value as 'summary' | 'history')} className="min-w-0">
        <TabsList activateOnFocus={true} indicator={false} fullWidth={false} aria-label={t('tabs')} className="flex max-w-full flex-wrap">
          <TabsTab ref={summaryTab} value="summary" className={focus}>{t('tabSummary')}</TabsTab>
          <TabsTab value="history" className={focus}>{t('tabHistory')}</TabsTab>
        </TabsList>
        <TabsPanel value="summary" keepMounted={false} className={`min-w-0 pt-4 ${focus}`}><Summary tenantId={tenantId} assignment={core.data.assignment} entitlements={core.data.entitlements} /></TabsPanel>
        <TabsPanel value="history" keepMounted={false} className={`min-w-0 pt-4 ${focus}`}>
          <History remote={history} page={historyPage} onPageChange={setHistoryPage} locale={language.language}
            onBackToSummary={() => { focusSummary.current = true; setTab('summary') }} />
        </TabsPanel>
      </Tabs>}
    {dialogOpen && <AssignmentDialog tenantId={tenantId} currentPlanId={core.data?.assignment.assignment?.planId ?? null} plans={plans} trigger={trigger}
      onBusyChange={setAssigning} onAssigned={assigned} onClose={() => setDialogOpen(false)} />}
  </Page>
}

function LocalizedToaster() {
  const { t } = useTranslation('pages.console-tenant-plan-page')
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    // Kit 0.11.0 exposes the close label but no toast viewport label prop.
    if (!container) return
    const translate = () => {
      const viewport = container.querySelector('[role="region"]')
      if (viewport && viewport.getAttribute('aria-label') !== t('notifications')) viewport.setAttribute('aria-label', t('notifications'))
    }
    translate()
    const observer = new MutationObserver(translate)
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] })
    return () => observer.disconnect()
  }, [container, t])
  return <><div ref={setContainer} />{container && <Toaster closeLabel={t('closeToast')} container={container} className="" />}</>
}

export default function ConsoleTenantPlanPage() {
  const { i18n: language } = useTranslation('pages.console-tenant-plan-page')
  const { tenantId = '' } = useParams()
  return <I18nProvider locale={language.language}><LiveAnnouncer><ToastProvider timeout={5000} limit={1}>
    <TenantPlan key={tenantId} tenantId={tenantId} /><LocalizedToaster />
  </ToastProvider></LiveAnnouncer></I18nProvider>
}
