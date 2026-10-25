import { useEffect, useRef, useState } from 'react'
import { AuthLayout, Button, LiveAnnouncer, Logo, useAnnounce } from '@gntik-ai/ui'
import { ErrorPanel, InlineCallout, ListSkeleton, NoAccessEmpty, NotFoundEmpty, PageHeader } from '@gntik-ai/blocks'
import { Link as RouterLink, matchPath, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { consoleAuthConfig, getConsoleAccountStatusView, type ApiError, type ConsoleAccountStatusView } from '@in-falcone/console-api'
import i18n from '../i18n'
import es from '../locales/es/pages.pending-activation-page.json'
import en from '../locales/en/pages.pending-activation-page.json'

i18n.addResourceBundle('es', 'pages.pending-activation-page', es)
i18n.addResourceBundle('en', 'pages.pending-activation-page', en)

interface RegistrationState {
  registrationId?: string
  state?: string
  statusView?: string
  activationMode?: string
}
const publicRoutes = ['/', '/login', '/password-recovery', '/invitations/:tenantId/:invitationId', '/signup', '/signup/pending-activation']
function ActionLink({ target, children, primary = false }: { target: string; children: string; primary?: boolean }) {
  const isPublic = publicRoutes.some((path) => matchPath(path, target.split(/[?#]/)[0]))
  return <Button render={isPublic ? <RouterLink to={target} /> : <a href={target} />} nativeButton={false} role="link"
    variant={primary ? 'primary' : 'secondary'} size="md" loading={false} disabled={false} iconOnly={false}
    icon={undefined} trailingIcon={undefined} className="max-w-full whitespace-normal wrap-anywhere">
    {children}
  </Button>
}

function PendingActivation() {
  const { t } = useTranslation('pages.pending-activation-page')
  const navigation = useLocation().state as RegistrationState | null
  const announce = useAnnounce()
  const [view, setView] = useState<ConsoleAccountStatusView | null>(null)
  const [error, setError] = useState<Partial<ApiError> | null>(null)
  const [busy, setBusy] = useState(true)
  const controller = useRef<AbortController | null>(null)
  const inFlight = useRef(false)
  const retryFocus = useRef(false)
  const status = useRef<HTMLDivElement>(null)
  const errorPanel = useRef<HTMLDivElement>(null)

  const load = async (request: AbortController, retry: boolean) => {
    if (inFlight.current) return
    inFlight.current = true
    controller.current = request
    retryFocus.current = retry
    setBusy(true)
    try {
      const next = await getConsoleAccountStatusView('pending_activation', request.signal)
      if (request.signal.aborted) return
      setView(next)
      setError(null)
      if (retry) announce(t('statusTitle'))
    } catch (cause) {
      if (request.signal.aborted) return
      setView(null)
      setError(cause as Partial<ApiError>)
      announce(t('errorTitle'), 'assertive')
    } finally {
      inFlight.current = false
      if (!request.signal.aborted) setBusy(false)
    }
  }
  useEffect(() => {
    const request = new AbortController()
    // Defer the read so StrictMode's discarded effect cannot send a second request.
    queueMicrotask(() => { if (!request.signal.aborted) void load(request, false) })
    return () => { request.abort(); controller.current?.abort() }
  }, [])
  useEffect(() => {
    const previousTitle = document.title
    document.title = t('documentTitle')
    return () => { document.title = previousTitle }
  }, [t])
  useEffect(() => {
    if (busy || !retryFocus.current) return
    retryFocus.current = false
    if (error) Array.from(errorPanel.current?.querySelectorAll('button') ?? []).find((button) => button.textContent === t('retry'))?.focus()
    else status.current?.focus()
  }, [busy, error])

  const isPending = navigation?.statusView === 'pending_activation' || navigation?.state === 'pending_activation'
  const outcome = t(isPending && navigation?.activationMode === 'approval_required' ? 'approvalPending'
    : isPending && ['auto_activate', 'self_service'].includes(navigation?.activationMode ?? '') ? 'activationPending' : 'fallbackMessage')
  const recovery = <div className="flex flex-wrap gap-3">
    <ActionLink target={consoleAuthConfig.loginPath} primary={true}>{t('login')}</ActionLink>
    <ActionLink target={consoleAuthConfig.signupPath} primary={false}>{t('signup')}</ActionLink>
  </div>
  const empty = error?.status === 403 || error?.status === 404
  return <AuthLayout variant="card" mainId="pending-activation-main" fullScreen={false}
    logo={<Logo size={28} wordmark={true} aria-label={t('logo')} />} brand={null} brandFooter={null}
    brandLabel={t('logo')} footer={null} skipLinkLabel={t('skip')} className="min-w-0">
    <div className="min-w-0 space-y-6 wrap-anywhere">
      <PageHeader as="div" breadcrumbs={null} title={t('title')} wrapTitle={true} titleRef={undefined} description={t('intro')}
        status="" statuses={{}} meta={[]} actions={[]} tabs={null} tab={undefined} defaultTab={undefined} onTabChange={undefined}
        labels={{ title: t('title'), description: t('intro'), moreActions: t('moreActions'), sections: t('sections') }} className="" />
      {error?.status === 403 ? <section aria-label={t('noAccessTitle')} className="space-y-4">
        <NoAccessEmpty resource="" owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined}
          defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0"
          labels={{ title: () => t('noAccessTitle'), description: () => t('noAccessDescription'), request: '', requested: '', sent: '' }} />
        {recovery}
      </section> : error?.status === 404 ? <NotFoundEmpty title={t('notFoundTitle')}
        description={`${t('notFoundDescription')}${navigation ? ` ${outcome}` : ''}`} action={recovery}
        titleAs="h2" bordered={false} icon={undefined} className="min-w-0" />
        : <div ref={status} tabIndex={-1} role="group" aria-label={t('statusTitle')}
          className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">
          <InlineCallout tone="info" title={t('statusTitle')} description={view?.statusView === 'pending_activation' ? t('statusMessage') : outcome}
            actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} labels={{ title: '', description: '', upgrade: '', viewUsage: '' }} className="" />
        </div>}
      {navigation?.registrationId ? <InlineCallout tone="info" title={t('referenceTitle')} description={t('reference', { id: navigation.registrationId })}
        actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} labels={{ title: '', description: '', upgrade: '', viewUsage: '' }} className="min-w-0 wrap-anywhere" /> : null}
      {error && !empty ? <div ref={errorPanel}><ErrorPanel title={t('errorTitle')} message={t('errorMessage')}
        code={error.status ?? null} requestId={error.status === 500 ? error.requestId ?? '' : ''} details="" icon={undefined}
        onRetry={() => load(new AbortController(), true)} retrying={busy} retryLabel={t('retry')} secondaryAction={null} titleAs="h2" announce={true}
        labels={{ title: t('errorTitle'), message: t('errorMessage'), support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} className="min-w-0 wrap-anywhere" /></div> : null}
      {busy && !error ? <ListSkeleton rows={1} label={t('loading')} className="min-w-0" /> : null}
      {!busy && view && view.allowedActions.length > 0 ? <div className="flex flex-wrap gap-3">
        {view.allowedActions.map((action, index) => <ActionLink key={`${action.actionId}-${index}`} target={action.target} primary={false}>
          {t(`actions.${Object.hasOwn(es.actions, action.actionId) ? action.actionId : 'unknown'}`)}
        </ActionLink>)}
      </div> : null}
      {!empty ? recovery : null}
    </div>
  </AuthLayout>
}

export default function PendingActivationPage() {
  return <LiveAnnouncer className="sr-only"><PendingActivation /></LiveAnnouncer>
}
