import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { I18nProvider, Page, Tabs, TabsList, TabsTab, TabsPanel, StatusTag, Card, CardHeader, CardTitle, CardBody, Button, Link, Timestamp, EmptyState, LiveAnnouncer, useAnnounce } from '@gntik-ai/ui'
import { PageHeader, DescriptionListCard, StatusTimeline, NoResultsEmpty, NotFoundEmpty, InlineCallout, TableSkeleton, ErrorPanel } from '@gntik-ai/blocks'
import type { ApiError } from '@in-falcone/console-api/http'
import { Guard } from '../shell/guards'
import i18n from '../i18n'
import es from '../locales/es/pages.console-runtime-page.json'
import en from '../locales/en/pages.console-runtime-page.json'
import { getKnativeRuntimeStatus, type KnativeRuntimeStatus } from './consoleRuntime/api'

i18n.addResourceBundle('es', 'pages.console-runtime-page', es)
i18n.addResourceBundle('en', 'pages.console-runtime-page', en)
const knownStates = ['ready', 'degraded', 'unverified', 'unavailable', 'disabled']
const knownModes = ['managed', 'external', 'disabled']

function Runtime() {
  const { t, i18n: language } = useTranslation('pages.console-runtime-page')
  const announce = useAnnounce()
  const [data, setData] = useState<KnativeRuntimeStatus | null>(null)
  const [error, setError] = useState<Partial<ApiError> | null>(null)
  const [busy, setBusy] = useState(true)
  const [tab, setTab] = useState('overview')
  const recheck = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const focusRecovery = useRef(false)
  const inFlight = useRef<Promise<void> | null>(null)
  const mounted = useRef(false)
  const label = (state: string) => t(`state.${knownStates.includes(state) ? state : 'unknown'}`)
  const load = () => {
    if (inFlight.current) return inFlight.current
    focusRecovery.current = Boolean(error)
    setBusy(true)
    const request = getKnativeRuntimeStatus().then((next) => {
      if (!mounted.current) return
      setData(next); setError(null)
      announce(t('updated', { state: knownStates.includes(next.state) ? label(next.state) : t('unknownAnnouncement') }))
    }).catch((cause: Partial<ApiError>) => {
      if (!mounted.current) return
      setData(null); setError(cause)
      if (cause.status !== 401) announce(t('errorAnnouncement'))
    }).finally(() => {
      inFlight.current = null
      if (mounted.current) setBusy(false)
    })
    inFlight.current = request
    return request
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false } }, [])
  useEffect(() => {
    document.title = t('documentTitle')
    return () => { document.title = t('consoleTitle') }
  }, [t])
  useEffect(() => {
    if (!busy && focusRecovery.current) {
      focusRecovery.current = false
      if (error) Array.from(panel.current?.querySelectorAll('button') ?? []).find((button) => button.textContent === t('retry'))?.focus()
      else recheck.current?.focus()
    }
  }, [busy, error])

  if (error?.status === 401) return null // Shared session transport and shell own refresh and redirect.
  const tone = data?.state === 'ready' ? 'success' : ['degraded', 'unavailable'].includes(data?.state ?? '') ? 'warning' : 'neutral'
  const state = data ? label(data.state) : ''
  const statuses = data ? { [data.state]: { label: state, tone } } as const : {}
  const back = <Link href="/console/overview" underline="always">{t('back')}</Link>
  const header = <PageHeader as="div" title={<span className="block whitespace-normal wrap-anywhere">{t('title')}</span>} description={<>{t('description')}<span className="block">{t('readOnly')}</span></>}
    breadcrumbs={null} status="" statuses={{}} meta={[]} actions={[]} tabs={null}
    labels={{ title: t('title'), description: t('description'), moreActions: t('sections'), sections: t('sections') }} />
  return <Page width="default" header={header} actions={null} actionBar={null} className="console-runtime min-w-0 wrap-anywhere">
    {data && <StatusTag status={data.state} statuses={statuses} label={state} aria-label={t('statusName', { state })} uppercase={false} />}
    {error?.status === 403 ? <EmptyState title={t('noAccess')} description={t('noAccessDescription')} titleAs="h2" bordered={false} primaryAction={back} secondaryAction={null} />
      : error?.status === 404 ? <NotFoundEmpty title={t('notFound')} description={t('notFoundDescription')} action={back} titleAs="h2" bordered={false} />
      : error ? <div ref={panel}><ErrorPanel title={t('errorTitle')} message={t('errorMessage')} code={error.status ?? null} requestId={error.requestId ?? ''} details="" secondaryAction={null}
        titleAs="h2" announce={false} retryLabel={t('retry')} retrying={busy} onRetry={load}
        labels={{ title: t('errorTitle'), message: t('errorMessage'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} /></div>
      : !data ? <><TableSkeleton rows={6} columns={2} label={t('loading')} /><p>{t('loadingNote')}</p></>
      : <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList aria-label={t('sections')}><TabsTab value="overview">{t('overview')}</TabsTab><TabsTab value="history">{t('history')}</TabsTab></TabsList>
        <TabsPanel value="overview" tabIndex={-1} className="space-y-4">
          <h2 className="text-lg font-semibold">{t('current')}</h2>
          <DescriptionListCard title={t('knative')} description="" titleAs="h3" onEdit={undefined} onCopy={undefined} editLabel={t('edit')}
            labels={{ title: t('knative'), description: '', edit: t('edit'), copy: (label) => t('copy', { label }), copied: (label) => t('copiedLabel', { label }), copiedToClipboard: t('copied') }}
            items={(['mode', 'owner', 'stage', 'compatibility', 'version', 'lastTransitionAt'] as const).map((key) => {
              const value = key === 'mode' ? t(`mode.${knownModes.includes(data.mode) ? data.mode : 'unknown'}`) : key === 'owner' ? data.owner || t('missingOwner') : key === 'version' ? data.version ?? t('missingVersion') : key === 'lastTransitionAt' ? data.lastTransitionAt ?? t('missingTransition') : data[key]
              return { id: key, label: t(`fields.${key}`), value, mono: false, copyable: false, copyValue: '', status: undefined,
                render: key === 'lastTransitionAt' && data.lastTransitionAt ? <Timestamp value={data.lastTransitionAt} format="absolute" locale={language.language} live={false} tooltip={false} fallback={t('missingTransition')} dateOptions={{ dateStyle: 'short', timeStyle: 'medium' }} /> : <span className="block whitespace-normal wrap-anywhere">{value}</span> }
            })} />
          {data.mode === 'disabled' && <InlineCallout tone="info" title={t('disabledNote')} description={null} actions={[]} dismissible={false} open={true} onDismiss={undefined} />}
          {data.state === 'unverified' && <InlineCallout tone="info" title={t('unverifiedNote')} description={null} actions={[]} dismissible={false} open={true} onDismiss={undefined} />}
          {['degraded', 'unavailable'].includes(data.state) && <><InlineCallout tone="warning" title={t('unavailableNote')} description={null} actions={[]} dismissible={false} open={true} onDismiss={undefined} />
            <InlineCallout tone="warning" title={t('advisory')} description={t('advisoryDescription')} actions={[]} dismissible={false} open={true} onDismiss={undefined} /></>}
          <Button ref={recheck} type="button" variant="secondary" loading={busy} disabled={busy} onClick={() => void load()}>{t('recheck')}</Button>
          <section className="grid min-w-0 gap-4 md:grid-cols-2" aria-label={t('dependencies')}>
            {(['functions', 'hostedMcp'] as const).map((key) => <Card key={key}><CardHeader><CardTitle as="h2">{t(key)}</CardTitle></CardHeader><CardBody className="space-y-4">
              <p>{t('dependencyDescription', { state: data.state === 'ready' ? t('available') : state })}</p>
              <Link href={key === 'functions' ? '/console/functions' : '/console'} underline="always">{t(key === 'functions' ? 'inspectFunctions' : 'inspectHostedMcp')}</Link>
            </CardBody></Card>)}
          </section>
        </TabsPanel>
        <TabsPanel value="history" tabIndex={-1}>
          {data.lastTransitionAt ? <StatusTimeline events={[{ id: 'transition', status: state, title: '', description: '', at: data.lastTransitionAt, actor: undefined, tone, live: false }]}
            label={t('history')} emptyLabel={t('missingTransition')} showFewerLabel={t('fewer')} showEarlierLabel={(count) => t('earlier', { count })} actorLabel={t('by')} maxVisible={undefined} timeFormat="absolute" />
            : <NoResultsEmpty query="" filterCount={0} entity={t('history')} onClearFilters={undefined} onClearSearch={undefined} titleAs="h2" bordered={false}
              labels={{ title: () => t('missingTransition'), queryTitle: () => t('missingTransition'), description: () => t('noHistory'), clearFilters: t('clearFilters'), clearSearch: t('clearSearch') }} />}
        </TabsPanel>
      </Tabs>}
  </Page>
}

export default function ConsoleRuntimePage() {
  const { t, i18n: language } = useTranslation('pages.console-runtime-page')
  return <Guard kind="observer" denialTitle={t('denialTitle')} denialDescription={t('denialDescription')}>
    <I18nProvider locale={language.language}><LiveAnnouncer><Runtime /></LiveAnnouncer></I18nProvider>
  </Guard>
}
