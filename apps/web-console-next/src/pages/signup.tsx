import { useEffect, useRef, useState } from 'react'
import { AuthLayout, EmptyState, Field, FieldError, FieldLabel, Grid, Input, Link, Logo, Section, Text, useAnnounce, useToast } from '@gntik-ai/ui'
import { ErrorPanel, FormSection, InlineCallout, ListSkeleton, PageHeader, StickyActionBar, ValidationSummary } from '@gntik-ai/blocks'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { createConsoleSignup, getConsoleSignupPolicy, type ConsoleSignupPolicy, type ConsoleSignupRegistration } from '@in-falcone/console-api/auth'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import type { ApiError } from '@in-falcone/console-api/http'
import i18n from '../i18n'
import es from '../locales/es/pages.signup-page.json'
import en from '../locales/en/pages.signup-page.json'

i18n.addResourceBundle('es', 'pages.signup-page', es)
i18n.addResourceBundle('en', 'pages.signup-page', en)

const emptyForm = { username: '', displayName: '', primaryEmail: '', tenantId: '', workspaceId: '', password: '' }
type FieldName = keyof typeof emptyForm
type Failure = Partial<ApiError>
const requiredFields: FieldName[] = ['username', 'displayName', 'primaryEmail', 'tenantId', 'password']
const focusClass = 'rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'

export default function SignupPage() {
  const { t } = useTranslation('pages.signup-page')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const announce = useAnnounce()
  const toast = useToast()
  const queryTenant = (params.get('tenantId') ?? params.get('tenant') ?? '').trim()
  const queryWorkspace = (params.get('workspaceId') ?? '').trim()
  const [form, setForm] = useState(() => ({ ...emptyForm, tenantId: queryTenant, workspaceId: queryWorkspace }))
  const [errors, setErrors] = useState<FieldName[]>([])
  const [attempts, setAttempts] = useState(0)
  const [policy, setPolicy] = useState<ConsoleSignupPolicy | null>(null)
  const [policyError, setPolicyError] = useState<Failure | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [registration, setRegistration] = useState<ConsoleSignupRegistration | null>(null)
  const [registrationTenant, setRegistrationTenant] = useState('')
  const controls = useRef<Partial<Record<FieldName, HTMLInputElement | null>>>({})
  const success = useRef<HTMLDivElement>(null)
  const formElement = useRef<HTMLFormElement>(null)
  const policyRequest = useRef<AbortController | null>(null)
  const submitRequest = useRef<AbortController | null>(null)
  const submitInFlight = useRef(false)
  const allowed = policy?.selfServiceEnabled === true
  const minimum = policy?.passwordPolicy?.minLength
  const passwordMin = typeof minimum === 'number' && Number.isFinite(minimum) && minimum > 0 ? minimum : 8

  async function loadPolicy(request: AbortController) {
    if (policyRequest.current && !policyRequest.current.signal.aborted) return
    policyRequest.current = request
    setLoading(true); setPolicy(null); setPolicyError(null)
    try {
      const next = await getConsoleSignupPolicy(request.signal)
      if (!request.signal.aborted) setPolicy(next)
    } catch (cause) {
      if (!request.signal.aborted) setPolicyError(cause as Failure)
    } finally {
      if (policyRequest.current === request) policyRequest.current = null
      if (!request.signal.aborted) setLoading(false)
    }
  }
  useEffect(() => {
    const request = new AbortController()
    // StrictMode's discarded mount cannot issue an extra policy read.
    queueMicrotask(() => { if (!request.signal.aborted) void loadPolicy(request) })
    document.getElementById('signup-main')?.focus()
    return () => { request.abort(); policyRequest.current?.abort(); submitRequest.current?.abort() }
  }, [])
  useEffect(() => {
    setForm((current) => ({ ...current, tenantId: current.tenantId || queryTenant, workspaceId: current.workspaceId || queryWorkspace }))
  }, [queryTenant, queryWorkspace])
  useEffect(() => {
    const previous = document.title
    document.title = t('documentTitle')
    return () => { document.title = previous }
  }, [t])
  // Child summary focus runs first; the legacy first-invalid target wins afterwards.
  useEffect(() => {
    if (attempts && errors.length) controls.current[errors[0]]?.focus()
  }, [attempts])
  useEffect(() => { if (registration) success.current?.focus() }, [registration])

  const failureTitle = (error: Failure) => t(error.status === 400 ? 'invalidTitle' : error.status === 403 ? 'deniedTitle' : error.status === 404 ? 'notFoundTitle' : error.status === 409 ? 'conflictTitle' : 'submitErrorTitle')
  const failureMessage = (error: Failure) => error.message || (error.status === 403 ? policy?.message || t('signupDisabled') : t(error.status === 400 ? 'invalidMessage' : error.status === 404 ? 'notFoundMessage' : error.status === 409 ? 'conflictMessage' : 'submitErrorMessage'))
  function notify(title: string, destructive = false) {
    toast.add({ title, description: undefined, tone: destructive ? 'destructive' : 'success', priority: destructive ? 'high' : 'low', timeout: 5000, action: undefined, dismissAction: undefined, onClose: undefined })
    announce(title, destructive ? 'assertive' : 'polite')
  }
  async function submit() {
    if (!allowed || loading || submitInFlight.current) return
    setFailure(null); setRegistration(null)
    const invalid = requiredFields.filter((name) => name === 'password' ? !form[name] : !form[name].trim())
    setErrors(invalid); setAttempts((current) => current + 1)
    if (invalid.length) { announce(t('validationTitle'), 'assertive'); return }
    submitInFlight.current = true
    const request = new AbortController()
    submitRequest.current = request
    setSubmitting(true)
    const tenantId = form.tenantId.trim()
    try {
      const workspaceId = form.workspaceId.trim()
      const created = await createConsoleSignup({
        username: form.username.trim(), displayName: form.displayName.trim(), primaryEmail: form.primaryEmail.trim(),
        tenantId, password: form.password, ...(workspaceId ? { workspaceId } : {})
      }, request.signal)
      if (request.signal.aborted) return
      if (created.state === 'pending_activation' || created.statusView === 'pending_activation') {
        notify(t('pendingTitle'))
        navigate(consoleAuthConfig.pendingActivationPath, { replace: true, state: {
          registrationId: created.registrationId, state: created.state, statusView: created.statusView,
          activationMode: created.activationMode, createdAt: created.createdAt, message: created.message
        } })
      } else {
        setRegistrationTenant(tenantId); setRegistration(created)
        notify(t('successTitle'))
      }
    } catch (cause) {
      if (request.signal.aborted) return
      const error = cause as Failure
      setFailure(error); notify(failureTitle(error), true)
    } finally {
      submitInFlight.current = false
      if (!request.signal.aborted) setSubmitting(false)
    }
  }
  const navLink = (target: string, label: string) => <Link render={<RouterLink to={target} />} tone="primary" underline="always" external={false} externalLabel="">{label}</Link>
  const login = navLink(consoleAuthConfig.loginPath, t('login'))
  const home = navLink('/', t('home'))
  const callout = (tone: 'info' | 'success' | 'destructive', title: string, description: string) => <InlineCallout tone={tone} title={title} description={description} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} labels={{ title: '', description: '', upgrade: '', viewUsage: '' }} className="min-w-0 wrap-anywhere" />
  const empty = (title: string, description: string) => <EmptyState title={title} description={description} titleAs="h2" icon={undefined} primaryAction={login} secondaryAction={home} size="sm" bordered={false} className="min-w-0 wrap-anywhere" children={null} />
  const panel = (error: Failure, isPolicy: boolean) => <ErrorPanel title={isPolicy ? t('policyErrorTitle') : failureTitle(error)} message={isPolicy ? t('policyErrorMessage') : failureMessage(error)}
    code={error.status ?? null} requestId={error.requestId ?? ''} details={isPolicy ? error.message ?? '' : ''} icon={undefined}
    onRetry={() => isPolicy ? loadPolicy(new AbortController()) : submit()} retrying={isPolicy ? loading : submitting} retryLabel={t('retry')} secondaryAction={null} titleAs="h2" announce={true}
    labels={{ title: '', message: '', support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} className="min-w-0 wrap-anywhere [&_code]:min-w-0 [&_code]:break-all [&_code]:whitespace-normal [&_code]:flex-1" />
  const field = (name: FieldName) => {
    const help = name === 'password' ? t('fields.password.help', { min: passwordMin }) : t(`fields.${name}.help`)
    const invalid = errors.includes(name)
    return <Field key={name} invalid={invalid} className="min-w-0 space-y-2">
      <FieldLabel htmlFor={name} required={false}>{t(`fields.${name}.label`)}</FieldLabel>
      <Input id={name} name={name} ref={(node) => { controls.current[name] = node }} type={name === 'password' ? 'password' : name === 'primaryEmail' ? 'email' : 'text'}
        autoComplete={({ username: 'username', displayName: 'name', primaryEmail: 'email', tenantId: 'organization', workspaceId: 'off', password: 'new-password' })[name]}
        value={form[name]} onValueChange={(value) => { setForm((current) => ({ ...current, [name]: value })); setErrors((current) => current.filter((key) => key !== name)) }}
        required={name !== 'workspaceId'} minLength={name === 'password' ? passwordMin : name === 'username' || name === 'tenantId' ? 3 : name === 'displayName' ? 1 : undefined}
        maxLength={name === 'username' ? 63 : name === 'primaryEmail' ? 160 : name === 'password' ? 256 : 120}
        pattern={name === 'username' ? '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$' : undefined}
        aria-invalid={invalid || undefined} aria-describedby={[help ? `${name}-help` : '', invalid ? `${name}-required` : ''].filter(Boolean).join(' ') || undefined}
        placeholder={t(`fields.${name}.placeholder`)} size="md" disabled={false} clearable={false} leadingAddon={undefined} trailingAddon={undefined} className="w-full min-w-0" />
      {help ? <Text id={`${name}-help`} as="p" variant="supporting" tone="muted" truncate={false} lineClamp={undefined}>{help}</Text> : null}
      {invalid ? <FieldError match={true} hideIcon={false} className="" id={`${name}-required`} role="alert">{t('requiredField')}</FieldError> : null}
    </Field>
  }
  const summary = loading ? t('loadingSummary') : !policy ? t('policyErrorMessage') : policy.message || t(allowed ? 'enabledSummary' : 'signupDisabled')
  return <AuthLayout variant="full-bleed" mainId="signup-main" fullScreen={false}
    logo={<Link render={<RouterLink to="/" aria-label={t('homeLabel')} />} tone="inherit" underline="none" external={false} externalLabel=""><Logo size={28} wordmark={true} aria-label={t('logo')} /></Link>}
    brand={null} brandFooter={null} brandLabel={t('logo')} footer={null} skipLinkLabel={t('skip')} className="min-w-0 [&>main>div]:max-w-7xl [&>main>div]:my-0 [&>main>div]:min-w-0">
    <div className="min-w-0 space-y-6 wrap-anywhere">
      <div className="sticky top-0 z-20 bg-background py-3">{navLink(consoleAuthConfig.loginPath, t('back'))}</div>
      <PageHeader as="div" breadcrumbs={null} title={t('title')} description={t('subtitle')} wrapTitle={true} titleRef={undefined} status="" statuses={{}} meta={[]} actions={[]} tabs={null} tab={undefined} defaultTab={undefined} onTabChange={undefined} labels={{ title: t('title'), description: t('subtitle'), moreActions: t('moreActions'), sections: t('sections') }} className="" />
      <Grid as="div" cols={{ base: 1, lg: 3 }} minChildWidth={undefined} gap={8} rowGap={8} align="start" flow="row" className="min-w-0">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          {loading ? <div role="status" aria-busy="true">{callout('info', t('loadingTitle'), summary)}<ListSkeleton rows={6} label={t('loadingTitle')} className="min-w-0" /></div>
            : policyError ? policyError.status === 403 ? empty(t('disabledTitle'), t('signupDisabled')) : policyError.status === 404 ? empty(t('notFoundTitle'), t('notFoundMessage')) : <div className="space-y-3">{panel(policyError, true)}{login}</div>
            : !allowed ? <div className="space-y-3">{callout('info', t('disabledTitle'), summary)}{login}</div> : null}
          {failure ? <div id="signup-feedback" className="space-y-3">{failure.status === 403 || failure.status === 404 ? empty(failureTitle(failure), failureMessage(failure)) : failure.status === undefined || failure.status >= 500 ? panel(failure, false) : callout('destructive', failureTitle(failure), failureMessage(failure))}</div> : null}
          {registration ? <div ref={success} tabIndex={-1} role="group" aria-label={t('successTitle')} className={`${focusClass} space-y-3`}>
            {callout('success', t('successTitle'), registration.message || t('successMessage'))}
            <Text as="p" variant="supporting" tone="default" truncate={false} lineClamp={undefined}>{t('reference', { id: registration.registrationId })}</Text>
            {navLink(`${consoleAuthConfig.loginPath}?${new URLSearchParams({ tenantId: registrationTenant })}`, t('continue'))}
          </div> : null}
          {allowed && !loading ? <form ref={formElement} noValidate onSubmit={(event) => { event.preventDefault(); void submit() }} aria-describedby={failure ? 'signup-feedback' : undefined} className="min-w-0 space-y-6">
            <ValidationSummary errors={errors.map((name) => ({ fieldId: name, label: t(`fields.${name}.label`), message: t('requiredField') }))} submitCount={attempts} title={t('validationTitle')} labels={{ title: () => t('validationTitle') }} className="min-w-0" />
            {(['account', 'organization', 'password'] as const).map((section) => <FormSection key={section} title={t(`${section}Title`)} description={t(section === 'password' ? 'passwordSectionHelp' : `${section}Help`)} actions={null} headingLevel="h2" divided={section !== 'account'} labels={{ title: '', description: '' }} className="min-w-0 [&>div]:min-w-0">
              <div className="min-w-0 space-y-5">{(section === 'account' ? ['username', 'displayName', 'primaryEmail'] as const : section === 'organization' ? ['tenantId', 'workspaceId'] as const : ['password'] as const).map(field)}</div>
            </FormSection>)}
            {navLink(consoleAuthConfig.loginPath, t('existing'))}
            <StickyActionBar dirty={true} saving={submitting} onSave={() => formElement.current?.requestSubmit()} onCancel={() => { setForm({ ...emptyForm, tenantId: queryTenant, workspaceId: queryWorkspace }); setErrors([]); setFailure(null); setRegistration(null) }} dirtyMessage={Object.entries(form).some(([key, value]) => value !== ({ ...emptyForm, tenantId: queryTenant, workspaceId: queryWorkspace })[key as FieldName]) ? t('dirty') : t('clean')} cleanMessage={t('clean')} saveLabel={t(submitting ? 'submitting' : 'submit')} cancelLabel={t('discard')} hideWhenClean={false} aria-label={t('actionsLabel')} className="min-w-0" />
          </form> : null}
        </div>
        <aside className="min-w-0"><Section variant="plain" padding="none" divided={false} title={t('asideTitle')} description={t('asideIntro')} actions={null} headingLevel="h2" bodyClassName="space-y-4" className="min-w-0">
          <div role="status" aria-busy={loading}>{callout('info', t(loading ? 'asideLoading' : allowed ? 'asideEnabled' : 'asideDisabled'), summary)}</div>
          <Text as="p" variant="supporting" tone="muted" truncate={false} lineClamp={undefined}>{t('approvalNote')}</Text>
        </Section></aside>
      </Grid>
    </div>
  </AuthLayout>
}
