import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AuthLayout, Alert, Button, Checkbox, EmptyState, Field, FieldLabel, Input, Link, LiveAnnouncer, Logo, PasswordInput, Section, Text, useAnnounce } from '@gntik-ai/ui'
import { ErrorPanel, InlineCallout, ListSkeleton, NoAccessEmpty, PageHeader } from '@gntik-ai/blocks'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { createConsoleLoginSession, getConsoleAccountStatusView, getConsoleSignupPolicy, inferStatusViewFromError, type ConsoleAccountStatusView, type ConsoleLoginRequest, type ConsoleSignupPolicy, type ConsoleStatusViewId } from '@in-falcone/console-api/auth'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import { consumeConsoleAuthStatusHint, consumeProtectedRouteIntent, ensureConsoleSession, persistConsoleShellSession, readConsoleShellSession } from '@in-falcone/console-api/session'
import type { ApiError } from '@in-falcone/console-api/http'
import { routerBasename } from '../router'
import i18n from '../i18n'
import es from '../locales/es/pages.login-page.json'
import en from '../locales/en/pages.login-page.json'

i18n.addResourceBundle('es', 'pages.login-page', es)
i18n.addResourceBundle('en', 'pages.login-page', en)

type Failure = Partial<ApiError>
type Feedback = { kind: 'credential' | 'denied' | 'service'; error: Failure } | null
const focusClass = 'rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
const describedBy = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(' ') || undefined

function resolvePostLoginDestination() {
  const intent = consumeProtectedRouteIntent()
  const base = routerBasename() === '/' ? '' : routerBasename()
  if (intent && !intent.startsWith('//') && intent.startsWith(`${base}/console/`)) return intent.slice(base.length)
  return getConsolePermissions(readConsoleShellSession()?.principal?.platformRoles).isReadOnly ? '/console/observability' : '/console/overview'
}

function Login() {
  const { t } = useTranslation('pages.login-page')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const announce = useAnnounce()
  const username = useRef<HTMLInputElement>(null)
  const password = useRef<HTMLInputElement>(null)
  const policyRegion = useRef<HTMLDivElement>(null)
  const statusRegion = useRef<HTMLDivElement>(null)
  const loginRegion = useRef<HTMLDivElement>(null)
  const retryFocus = useRef<'policy' | 'status' | 'login' | null>(null)
  const [form, setForm] = useState({ username: '', password: '', rememberMe: false })
  const [fieldErrors, setFieldErrors] = useState({ username: false, password: false })
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [hint, setHint] = useState<ConsoleStatusViewId | null>(null)
  const [policy, setPolicy] = useState<ConsoleSignupPolicy | null>(null)
  const [policyError, setPolicyError] = useState<Failure | null>(null)
  const [policyBusy, setPolicyBusy] = useState(true)
  const [status, setStatus] = useState<ConsoleAccountStatusView | null>(null)
  const [statusError, setStatusError] = useState<Failure | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const policyInFlight = useRef(false)
  const statusInFlight = useRef(false)
  const submitInFlight = useRef(false)
  const lastAttempt = useRef<ConsoleLoginRequest | null>(null)
  const mounted = useRef(false)
  const statusRequest = useRef<AbortController | null>(null)

  // Config defaults are Spanish. Only operator overrides bypass namespace translation.
  const label = (key: keyof typeof es.labels) => consoleAuthConfig.labels[key] === es.labels[key] ? t(`labels.${key}`) : consoleAuthConfig.labels[key]
  const heading = (key: 'title' | 'subtitle') => consoleAuthConfig.headings[key] === es[key] ? t(key) : consoleAuthConfig.headings[key]
  const statusKey = (id: string) => Object.hasOwn(es.statuses, id) ? id : 'unknown'
  const statusTitle = (id: string) => t(`statuses.${statusKey(id)}.title`)
  const tenantId = (params.get('tenantId') ?? params.get('tenant') ?? '').trim() || undefined
  const workspaceId = (params.get('workspaceId') ?? '').trim() || undefined
  const signupParams = new URLSearchParams()
  if (tenantId) signupParams.set('tenantId', tenantId)
  if (workspaceId) signupParams.set('workspaceId', workspaceId)
  const signupTarget = consoleAuthConfig.signupPath + (signupParams.size ? `?${signupParams}` : '')
  const context = tenantId && workspaceId ? t('contextBoth', { tenantId, workspaceId }) : tenantId ? t('contextTenant', { tenantId }) : workspaceId ? t('contextWorkspace', { workspaceId }) : null
  const invalidCredentials = feedback?.kind === 'credential' || feedback?.kind === 'denied'

  async function loadPolicy(request: AbortController, retry = false) {
    if (policyInFlight.current) return
    policyInFlight.current = true
    if (retry) retryFocus.current = 'policy'
    setPolicyBusy(true)
    try {
      const next = await getConsoleSignupPolicy(request.signal)
      if (request.signal.aborted || !mounted.current) return
      setPolicy(next); setPolicyError(null)
    } catch (cause) {
      if (request.signal.aborted || !mounted.current) return
      setPolicy(null); setPolicyError(cause as Failure)
      announce(t('policyErrorTitle'))
    } finally {
      policyInFlight.current = false
      if (!request.signal.aborted && mounted.current) setPolicyBusy(false)
    }
  }
  async function loadStatus(id: ConsoleStatusViewId, retry = false) {
    if (statusInFlight.current && !statusRequest.current?.signal.aborted) return
    statusInFlight.current = true
    const request = new AbortController()
    statusRequest.current = request
    if (retry) retryFocus.current = 'status'
    setStatusBusy(true)
    try {
      const next = await getConsoleAccountStatusView(id, request.signal)
      if (request.signal.aborted || !mounted.current) return
      setStatus(next); setStatusError(null)
    } catch (cause) {
      if (request.signal.aborted || !mounted.current) return
      setStatusError(cause as Failure)
      announce(t('statusErrorTitle'))
    } finally {
      if (statusRequest.current === request) {
        statusInFlight.current = false
        if (mounted.current) setStatusBusy(false)
      }
    }
  }
  useEffect(() => {
    mounted.current = true
    const request = new AbortController()
    // StrictMode's discarded effect must not consume the hint or send another read.
    queueMicrotask(() => {
      if (request.signal.aborted) return
      setHint(consumeConsoleAuthStatusHint()?.statusView ?? null)
      void loadPolicy(request)
      void ensureConsoleSession().then((session) => {
        if (!request.signal.aborted && session) navigate(resolvePostLoginDestination(), { replace: true })
      }).catch(() => undefined)
    })
    return () => { mounted.current = false; request.abort(); statusRequest.current?.abort() }
  }, [navigate])
  useEffect(() => {
    const previousTitle = document.title
    document.title = t('documentTitle')
    return () => { document.title = previousTitle }
  }, [t])
  useLayoutEffect(() => {
    const target = retryFocus.current
    if (!target || (target === 'policy' ? policyBusy : target === 'status' ? statusBusy : submitting)) return
    retryFocus.current = null
    const region = target === 'policy' ? policyRegion.current : target === 'status' ? statusRegion.current : loginRegion.current
    const error = target === 'policy' ? policyError : target === 'status' ? statusError : feedback
    if (target === 'login' && invalidCredentials) { password.current?.focus(); return }
    if (error) Array.from(region?.querySelectorAll('button') ?? []).find((button) => button.textContent === t('retry'))?.focus()
    else if (target === 'policy') (region?.querySelector<HTMLElement>('[data-signup], [data-disabled]') ?? null)?.focus()
    else if (target === 'status') region?.querySelector<HTMLElement>('[data-status]')?.focus()
  }, [policyBusy, statusBusy, submitting, policyError, statusError, feedback, invalidCredentials, t])

  async function submit(retry = false) {
    if (submitInFlight.current) return
    const payload = retry && lastAttempt.current ? lastAttempt.current : { username: form.username.trim(), password: form.password, rememberMe: form.rememberMe, ...(tenantId ? { tenantId } : {}) }
    const errors = { username: !payload.username, password: !payload.password }
    setFieldErrors(errors)
    if (errors.username || errors.password) { (errors.username ? username : password).current?.focus(); return }
    statusRequest.current?.abort()
    submitInFlight.current = true
    retryFocus.current = retry ? 'login' : null
    if (!retry) setFeedback(null)
    setHint(null); setStatus(null); setStatusError(null); setSubmitting(true)
    try {
      lastAttempt.current = payload
      const session = await createConsoleLoginSession(payload)
      if (!mounted.current) return
      persistConsoleShellSession(session, tenantId)
      navigate(resolvePostLoginDestination(), { replace: true })
    } catch (cause) {
      if (!mounted.current) return
      const error = cause as Failure
      const inferred = error.status === 409 ? inferStatusViewFromError(error as ApiError) : null
      if (inferred) {
        setFeedback(null)
        setStatus({ ...inferred, allowedActions: [] })
        if (inferred.statusView !== 'login') await loadStatus(inferred.statusView)
      } else if (error.status === 403 || error.status === 400 || error.status === 401 || (error.status !== undefined && error.code?.trim().toUpperCase() === 'INVALID_CREDENTIALS')) {
        setFeedback({ kind: error.status === 403 ? 'denied' : 'credential', error })
        password.current?.focus()
      } else {
        setFeedback({ kind: 'service', error })
        announce(t(error.status ? 'loginErrorTitle' : 'networkTitle'), 'assertive')
      }
    } finally {
      submitInFlight.current = false
      if (mounted.current) setSubmitting(false)
    }
  }
  const returnButton = <Button type="button" variant="secondary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} onClick={() => username.current?.focus()}>{t('returnToForm')}</Button>
  const noAccess = (title: string, description: string) => <NoAccessEmpty resource="" owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0" labels={{ title: () => title, description: () => description, request: '', requested: '', sent: '' }} />
  const missing = (title: string, description: string) => <EmptyState title={title} description={description} titleAs="h2" icon={undefined} primaryAction={returnButton} secondaryAction={null} size="sm" bordered={false} className="min-w-0" children={null} />
  const panel = (error: Failure, area: 'login' | 'policy' | 'status', busy: boolean, retry: () => Promise<void>) => <ErrorPanel
    title={t(error.status ? `${area}ErrorTitle` : 'networkTitle')} message={t(error.status ? `${area}ErrorMessage` : 'networkMessage')}
    code={error.status ?? null} requestId={error.status ? error.requestId ?? '' : ''} details={error.message ?? ''} icon={undefined}
    onRetry={retry} retrying={busy} retryLabel={t('retry')} secondaryAction={null} titleAs="h2" announce={true}
    labels={{ title: '', message: '', support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} className="min-w-0 wrap-anywhere [&_code]:min-w-0 [&_code]:break-all [&_code]:whitespace-normal [&_code]:flex-1" />
  const action = status?.allowedActions[0] ?? (status?.statusView === 'pending_activation' ? { actionId: 'view_pending_activation', target: consoleAuthConfig.pendingActivationPath } : null)
  const callout = (id: string) => <InlineCallout tone="info" title={statusTitle(id)} description={t(`statuses.${statusKey(id)}.message`)} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} labels={{ title: '', description: '', upgrade: '', viewUsage: '' }} className="min-w-0" />

  return <AuthLayout variant="card" mainId="login-main" fullScreen={false} logo={<Logo size={28} wordmark={true} aria-label={t('logo')} />}
    brand={null} brandFooter={null} brandLabel={t('logo')} footer={null} skipLinkLabel={t('skip')} className="min-w-0">
    <div className="min-w-0 space-y-6 wrap-anywhere">
      <PageHeader as="div" breadcrumbs={null} title={heading('title')} description={heading('subtitle')} wrapTitle={true} titleRef={undefined}
        status="" statuses={{}} meta={[]} actions={[]} tabs={null} tab={undefined} defaultTab={undefined} onTabChange={undefined}
        labels={{ title: heading('title'), description: heading('subtitle'), moreActions: t('moreActions'), sections: t('sections') }} className="" />
      <div ref={loginRegion}>
        {hint ? <div><InlineCallout tone="info" title={hint === 'login' ? t('expiredHintTitle') : statusTitle(hint)} description={hint === 'login' ? t('expiredHintMessage') : t(`statuses.${statusKey(hint)}.message`)}
          actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} labels={{ title: '', description: '', upgrade: '', viewUsage: '' }} className="min-w-0" /></div> : null}
        {invalidCredentials ? <div className="space-y-3">
          <div id="login-feedback" role={feedback?.kind === 'denied' ? 'alert' : undefined} aria-live={feedback?.kind === 'denied' ? 'assertive' : undefined} aria-atomic={feedback?.kind === 'denied' ? true : undefined}>
            {feedback?.kind === 'denied' ? noAccess(t('credentialTitle'), t('deniedMessage')) : <Alert tone="destructive" title={t('credentialTitle')} description={t('credentialMessage')} actions={null} icon={undefined} onDismiss={undefined} dismissLabel="" role="alert" aria-live="assertive" aria-atomic="true" className="" />}
          </div>
          {feedback?.error.message ? <details><summary className={focusClass}>{t('details')}</summary><Text as="p" variant="supporting" tone="muted" truncate={false} lineClamp={undefined}>{feedback.error.message}</Text></details> : null}
        </div> : feedback?.kind === 'service' ? panel(feedback.error, 'login', submitting, () => submit(true)) : null}
      </div>
      <form noValidate onSubmit={(event) => { event.preventDefault(); void submit() }} aria-describedby={invalidCredentials ? 'login-feedback' : undefined} className="space-y-5">
        <Field invalid={invalidCredentials || fieldErrors.username} className="space-y-2">
          <FieldLabel htmlFor="username" required={false}>{label('username')}</FieldLabel>
          <Input id="username" name="username" type="text" autoComplete="username" autoFocus ref={username} required minLength={3} maxLength={120}
            value={form.username} onValueChange={(value) => { setForm((current) => ({ ...current, username: value })); setFieldErrors((current) => ({ ...current, username: false })) }}
            aria-invalid={invalidCredentials || fieldErrors.username || undefined} aria-describedby={describedBy('login-username-help', fieldErrors.username && 'login-username-required', invalidCredentials && 'login-feedback')}
            placeholder={t('usernamePlaceholder')} size="md" disabled={false} clearable={false} leadingAddon={undefined} trailingAddon={undefined} className="w-full" />
          <Text id="login-username-help" as="p" variant="supporting" tone="muted" truncate={false} lineClamp={undefined}>{t('usernameHelp')}</Text>
          {fieldErrors.username ? <Text id="login-username-required" role="alert" as="p" variant="supporting" tone="destructive" truncate={false} lineClamp={undefined}>{label('requiredField')}</Text> : null}
        </Field>
        <Field invalid={invalidCredentials || fieldErrors.password} className="space-y-2">
          <FieldLabel htmlFor="password" required={false}>{label('password')}</FieldLabel>
          <PasswordInput id="password" name="password" autoComplete="current-password" ref={password} required maxLength={256}
            value={form.password} onValueChange={(value) => { setForm((current) => ({ ...current, password: value })); setFieldErrors((current) => ({ ...current, password: false })) }}
            aria-invalid={invalidCredentials || fieldErrors.password || undefined} aria-describedby={describedBy('login-password-help', fieldErrors.password && 'login-password-required', invalidCredentials && 'login-feedback')}
            placeholder={t('passwordPlaceholder')} size="md" disabled={false} clearable={false} leadingAddon={undefined} showStrength={false} strength={undefined}
            strengthLabels={[t('strength'), t('strength'), t('strength'), t('strength'), t('strength')]} strengthPrefix={t('strength')} showLabel={t('showPassword')} hideLabel={t('hidePassword')} wrapperClassName="w-full" className="w-full [&_button]:hidden" />
          <Text id="login-password-help" as="p" variant="supporting" tone="muted" truncate={false} lineClamp={undefined}>{t('passwordHelp')}</Text>
          {fieldErrors.password ? <Text id="login-password-required" role="alert" as="p" variant="supporting" tone="destructive" truncate={false} lineClamp={undefined}>{label('requiredField')}</Text> : null}
        </Field>
        <label className="flex items-start gap-3 text-sm"><Checkbox checked={form.rememberMe} onCheckedChange={(checked) => setForm((current) => ({ ...current, rememberMe: checked }))} disabled={false} indeterminate={false} name="rememberMe" />{label('rememberMe')}</label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="submit" variant="primary" size="md" disabled={submitting} loading={submitting} aria-busy={submitting} iconOnly={false} icon={undefined} trailingIcon={undefined} className="w-full sm:w-auto">{label(submitting ? 'submitLoading' : 'submit')}</Button>
          <Link render={<RouterLink to={consoleAuthConfig.passwordRecoveryPath} />} tone="primary" underline="always" external={false} externalLabel="">{label('passwordRecovery')}</Link>
        </div>
      </form>
      <div ref={statusRegion} aria-live={statusError?.status === 403 || statusError?.status === 404 ? 'polite' : undefined} aria-atomic="true" className="space-y-3">
        {status ? statusError?.status === 403 ? <>{noAccess(t('statusDeniedTitle'), statusTitle(status.statusView))}{returnButton}</> : statusError?.status === 404 ? missing(t('statusMissingTitle'), statusTitle(status.statusView)) : <>
          <div data-status tabIndex={-1} className={focusClass}>{callout(status.statusView)}
            {action ? <Link render={<RouterLink to={action.target} />} tone="primary" underline="always" external={false} externalLabel="">{t(`actions.${Object.hasOwn(es.actions, action.actionId) ? action.actionId : 'unknown'}`)}</Link> : null}
          </div>
          {statusError ? panel(statusError, 'status', statusBusy, () => loadStatus(status.statusView, true)) : null}
        </> : null}
      </div>
      <Section variant="plain" padding="none" divided={false} title={t('asideTitle')} description={t('asideDescription')} actions={null} headingLevel="h2" bodyClassName="space-y-4" className="min-w-0">
        <div ref={policyRegion} aria-live={policyBusy && !policyError ? undefined : 'polite'} aria-atomic="true" className="space-y-3">
          {policyBusy && !policyError ? <ListSkeleton rows={2} label={t('policyLoading')} className="min-w-0" /> : policyError ? policyError.status === 403 ? <>{noAccess(t('policyDeniedTitle'), t('policyDeniedMessage'))}{returnButton}</> : policyError.status === 404 ? missing(t('policyMissingTitle'), t('policyMissingMessage')) : panel(policyError, 'policy', policyBusy, () => loadPolicy(new AbortController(), true)) : policy?.selfServiceEnabled ? <>
            <Button render={<RouterLink to={signupTarget} data-signup aria-describedby={context ? 'signup-context-help' : undefined} />} nativeButton={false} role="link" variant="secondary" size="md" loading={false} disabled={false} iconOnly={false} icon={undefined} trailingIcon={undefined} className="w-full whitespace-normal">{label('signup')}</Button>
            {context ? <Text id="signup-context-help" as="p" variant="supporting" tone="muted" truncate={false} lineClamp={undefined}>{context}</Text> : null}
          </> : policy ? <div data-disabled tabIndex={-1} className={focusClass}><EmptyState title={t('signupDisabledTitle')} description={policy.mode === 'invitation' ? t('invitationOnly') : label('signupDisabled')}
            icon={undefined} primaryAction={null} secondaryAction={null} children={null} size="sm" titleAs="h3" bordered={false} className="min-w-0" /></div> : null}
        </div>
        <Text as="p" variant="supporting" tone="muted" truncate={false} lineClamp={undefined}>{t('sessionProtection')}</Text>
      </Section>
    </div>
  </AuthLayout>
}

export default function LoginPage() {
  return <LiveAnnouncer className="sr-only"><Login /></LiveAnnouncer>
}
