import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, EmptyState, I18nProvider, Link, Page, Tabs, TabsList, TabsPanel, TabsTab, Text } from '@gntik-ai/ui'
import { ErrorPanel, NoAccessEmpty, NotFoundEmpty, PageHeader, TableSkeleton } from '@gntik-ai/blocks'
import type { ApiError } from '@in-falcone/console-api/http'
import i18n from '../i18n'
import { useSession } from '../shell/session'
import { isMigratedRoute } from '../shell/navigation'
import { getEffectiveEntitlements, type EffectiveEntitlements } from './consoleTenantPlanOverview/api'
import { Summary } from './consoleTenantPlanOverview/Summary'
import es from '../locales/es/pages.console-tenant-plan-overview-page.json'
import en from '../locales/en/pages.console-tenant-plan-overview-page.json'
import './consoleTenantPlanOverview/page.css'

i18n.addResourceBundle('es', 'pages.console-tenant-plan-overview-page', es)
i18n.addResourceBundle('en', 'pages.console-tenant-plan-overview-page', en)
const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
const overviewHref = '/console/overview'

function TenantPlanOverview() {
  const { t } = useTranslation('pages.console-tenant-plan-overview-page')
  const navigate = useNavigate()
  const principal = useSession()?.principal
  const roles = principal?.platformRoles ?? []
  // Same predicate as the legacy page: platform principals without a tenant have no personal plan.
  const tenantless = roles.some((role) => ['superadmin', 'platform_admin', 'platform_operator'].includes(role)) && !(principal?.tenantIds ?? []).filter(Boolean).length
  const canOpenCatalog = roles.includes('superadmin')
  const [data, setData] = useState<EffectiveEntitlements | null>(null)
  const [failure, setFailure] = useState<Pick<Partial<ApiError>, 'status' | 'requestId'> | null>(null)
  const [loading, setLoading] = useState(!tenantless)
  const [attempt, setAttempt] = useState(0)
  const [tab, setTab] = useState('summary')
  const heading = useRef<HTMLHeadingElement>(null)
  const retry = useRef<HTMLButtonElement>(null)
  const retryRequested = useRef(false)
  const inFlight = useRef(false)
  useEffect(() => {
    let active = true
    if (tenantless) { setData(null); setFailure(null); setLoading(false); return }
    inFlight.current = true
    setLoading(true)
    // A previous summary is never shown as fresh while a new request is pending.
    setData(null)
    if (!retryRequested.current) setFailure(null)
    void getEffectiveEntitlements().then((summary) => {
      if (!active) return
      setData(summary)
      setFailure(null)
    }).catch((cause: unknown) => {
      if (!active) return
      const error = (cause && typeof cause === 'object' ? cause : {}) as Partial<ApiError>
      setFailure({ status: typeof error.status === 'number' ? error.status : undefined,
        requestId: typeof error.requestId === 'string' ? error.requestId : undefined })
    }).finally(() => {
      if (active) { inFlight.current = false; setLoading(false) }
    })
    return () => { active = false }
  }, [tenantless, attempt])
  useEffect(() => {
    // A new retry can start before the preceding render's focus effect runs.
    if (loading || inFlight.current || !retryRequested.current) return
    if (failure && ![401, 403, 404].includes(failure.status ?? 0)) retry.current?.focus()
    else heading.current?.focus()
    retryRequested.current = false
  }, [loading, failure])

  const overview = isMigratedRoute(overviewHref)
    ? <RouterLink to={overviewHref} state={{ focusMainHeading: true }} className={`underline ${focus}`}>{t('backToOverview')}</RouterLink>
    : <Link href={overviewHref} underline="always" external={false} externalLabel="">{t('backToOverview')}</Link>
  const header = <PageHeader as="div" title={t('title')} description={t('description')} titleRef={heading} wrapTitle={true}
    breadcrumbs={null} status="" statuses={{}} meta={[]} actions={[]} tabs={null}
    labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('tabs') }} />
  const message = t(failure?.status ? 'errorMessage' : 'networkMessage')
  const retryable = failure && ![401, 403, 404].includes(failure.status ?? 0)
  const openCatalog = <Button type="button" variant="secondary" onClick={() => navigate('/console/plans', { state: { focusMainHeading: true } })}>{t('openCatalog')}</Button>

  return <Page width="wide" header={header} title={null} description={null} actions={null} actionBar={null}
    actionBarLabel={t('actions')} className="my-plan min-w-0 space-y-6 wrap-anywhere">
    {tenantless ? <EmptyState title={t('tenantlessTitle')} description={t(canOpenCatalog ? 'tenantlessCatalogDescription' : 'tenantlessDescription')} icon={undefined}
      primaryAction={canOpenCatalog ? openCatalog : null} secondaryAction={null} titleAs="h2" bordered={true} className="min-w-0" />
      : failure?.status === 403 ? <div role="alert" className="min-w-0"><NoAccessEmpty resource={t('title')} owner="" onRequestAccess={undefined} showRequestAccess={false}
        action={undefined} defaultRequested={false} titleAs="h2" bordered={false}
        labels={{ title: () => t('noAccessTitle'), description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} /></div>
      : failure?.status === 404 ? <div role="alert" className="min-w-0"><NotFoundEmpty icon={undefined} title={t('notFoundTitle')} description={t('notFoundDescription')} action={overview} titleAs="h2" bordered={false} /></div>
      : retryable ? <div className="min-w-0 space-y-3" data-testid="my-plan-error">
        <ErrorPanel title={t('errorTitle')} message={message} code={failure.status ?? null} requestId={failure.requestId ?? ''} details=""
          onRetry={undefined} retrying={false} retryLabel={t('retry')} secondaryAction={null} titleAs="h2" announce={true}
          labels={{ title: t('errorTitle'), message, support: '', retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'),
            requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
        <Button ref={retry} type="button" variant="secondary" aria-disabled={loading} aria-busy={loading}
          onClick={() => { if (inFlight.current) return; retryRequested.current = true; inFlight.current = true; setAttempt((value) => value + 1) }}>{t(loading ? 'retrying' : 'retry')}</Button>
      </div>
      : loading || failure?.status === 401 || !data ? <section role="status" aria-label={t('loading')} aria-busy={true}>
        <Text>{t('loadingDescription')}</Text><div aria-hidden={true}><TableSkeleton rows={4} columns={5} label={t('loading')} className="min-w-0" /></div>
      </section>
      : <Tabs value={tab} defaultValue={undefined} variant="underline" orientation="horizontal" onValueChange={(value) => setTab(String(value))} className="min-w-0">
        <TabsList activateOnFocus={true} indicator={false} fullWidth={false} aria-label={t('tabs')} className="flex max-w-full flex-wrap">
          <TabsTab value="summary" className={focus}>{t('tabSummary')}</TabsTab>
          <TabsTab value="history" className={focus}>{t('tabHistory')}</TabsTab>
        </TabsList>
        <TabsPanel value="summary" keepMounted={false} className={`min-w-0 pt-4 ${focus}`}><Summary data={data} /></TabsPanel>
        <TabsPanel value="history" keepMounted={false} className={`min-w-0 pt-4 ${focus}`}>
          {/* No self-scoped history route exists yet, so this tab renders its empty state and sends no request. */}
          <section className="min-w-0 space-y-3" aria-labelledby="my-plan-history-heading" data-testid="my-plan-history">
            <h2 id="my-plan-history-heading" className="text-base font-semibold">{t('historyTitle')}</h2>
            <EmptyState title={t('historyEmptyTitle')} description={t('historyEmptyDescription')} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h3" bordered={true} className="min-w-0" />
          </section>
        </TabsPanel>
      </Tabs>}
  </Page>
}

export default function ConsoleTenantPlanOverview() {
  const { i18n: language } = useTranslation('pages.console-tenant-plan-overview-page')
  return <I18nProvider locale={language.language}><TenantPlanOverview /></I18nProvider>
}
