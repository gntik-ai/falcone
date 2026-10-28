import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert, AuthLayout, Button, EmptyState, Field, FieldLabel, Input, Link, LiveAnnouncer, Logo, Section, Text, Timestamp } from '@gntik-ai/ui'
import { ErrorPanel, InlineCallout, ListSkeleton, NoAccessEmpty, PageHeader } from '@gntik-ai/blocks'
import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { createConsolePasswordRecoveryRequest, type ConsolePasswordRecoveryRequest, type ConsolePasswordRecoveryTicket } from '@in-falcone/console-api/auth'
import { consoleAuthConfig } from '@in-falcone/console-api/config'
import type { ApiError } from '@in-falcone/console-api/http'
import i18n from '../i18n'
import es from '../locales/es/pages.password-recovery-page.json'
import en from '../locales/en/pages.password-recovery-page.json'

i18n.addResourceBundle('es', 'pages.password-recovery-page', es)
i18n.addResourceBundle('en', 'pages.password-recovery-page', en)

type Failure = Partial<ApiError>
const focusClass = 'rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'

function Recovery() {
  const { t, i18n: locale } = useTranslation('pages.password-recovery-page')
  const input = useRef<HTMLInputElement>(null)
  const submitButton = useRef<HTMLButtonElement>(null)
  const result = useRef<HTMLDivElement>(null)
  const [identifier, setIdentifier] = useState('')
  const [required, setRequired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ticket, setTicket] = useState<ConsolePasswordRecoveryTicket | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const inFlight = useRef(false)
  const lastAttempt = useRef<ConsolePasswordRecoveryRequest | null>(null)
  const restoreFocus = useRef<'submit' | 'retry' | null>(null)
  const request = useRef<AbortController | null>(null)
  const serviceError = failure !== null && ![400, 403, 404, 429].includes(failure.status ?? 0)
  const stateLink = failure?.status === 403 || failure?.status === 404

  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    const previousTitle = document.title
    document.title = t('documentTitle')
    return () => { document.title = previousTitle }
  }, [t])
  const retryButton = () => Array.from(result.current?.querySelectorAll('button') ?? []).find((button) => button.textContent === t('retry'))
  useLayoutEffect(() => {
    if (busy || !restoreFocus.current) return
    const target = restoreFocus.current
    restoreFocus.current = null
    if (target === 'retry' && serviceError) retryButton()?.focus()
    else submitButton.current?.focus()
  }, [busy, failure, serviceError, t])

  async function submit(retry = false) {
    if (inFlight.current) return
    setTicket(null)
    setFailure(null)
    const payload = retry && lastAttempt.current ? lastAttempt.current : { usernameOrEmail: identifier.trim(), deliveryChannel: 'email' as const }
    setRequired(!payload.usernameOrEmail)
    if (!payload.usernameOrEmail) { input.current?.focus(); return }
    inFlight.current = true
    restoreFocus.current = retry ? 'retry' : 'submit'
    lastAttempt.current = payload
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    try {
      const created = await createConsolePasswordRecoveryRequest(payload, controller.signal)
      if (!controller.signal.aborted) setTicket(created)
    } catch (cause) {
      if (!controller.signal.aborted) {
        const error = cause as Failure
        // Response messages and details must never disclose account existence.
        setFailure({ status: error.status, requestId: error.requestId })
      }
    } finally {
      inFlight.current = false
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  const back = <Link render={<RouterLink to={consoleAuthConfig.loginPath} />} tone="primary" underline="always" external={false} externalLabel="" className={`inline-flex w-full justify-center py-2 sm:w-auto ${focusClass}`}>{t('back')}</Link>
  const callout = (tone: 'success' | 'info', title: string, description: string) => <InlineCallout tone={tone} title={title} description={description}
    actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} labels={{ title: '', description: '', upgrade: '', viewUsage: '' }} className="min-w-0" />

  return <AuthLayout variant="card" mainId="password-recovery-main" fullScreen={false}
    logo={<Logo size={28} wordmark={true} aria-label={t('logo')} />} brand={null} brandFooter={null} brandLabel={t('logo')}
    footer={null} skipLinkLabel={t('skip')} className="min-w-0">
    <div className="min-w-0 space-y-6 wrap-anywhere">
      <PageHeader as="div" breadcrumbs={null} title={t('title')} description={t('intro')} wrapTitle={true} titleRef={undefined}
        status="recovery" statuses={{ recovery: { label: t('badge'), tone: 'neutral' } }} meta={[]} actions={[]} tabs={null}
        tab={undefined} defaultTab={undefined} onTabChange={undefined} labels={{ title: t('title'), description: t('intro'), moreActions: t('moreActions'), sections: t('sections') }} className="" />
      <form noValidate onSubmit={(event) => { event.preventDefault(); void submit() }} className="space-y-5">
        <Field invalid={required} className="space-y-2">
          <FieldLabel htmlFor="usernameOrEmail" required={false}>{t('identifier')}</FieldLabel>
          <Input id="usernameOrEmail" name="usernameOrEmail" type="text" autoComplete="username" autoCapitalize="none" autoFocus ref={input}
            required minLength={3} maxLength={255} value={identifier} onValueChange={(value) => { setIdentifier(value); setRequired(false) }}
            aria-invalid={required || undefined} aria-describedby={`password-recovery-username-help${required ? ' password-recovery-username-required' : ''}`}
            placeholder={t('placeholder')} size="md" disabled={false} clearable={false} leadingAddon={undefined} trailingAddon={undefined} className="w-full" />
          <Text id="password-recovery-username-help" as="p" variant="supporting" tone="muted" truncate={false} lineClamp={undefined}>{t('help')}</Text>
          {required ? <Text id="password-recovery-username-required" role="alert" as="p" variant="supporting" tone="destructive" truncate={false} lineClamp={undefined}>{t('required')}</Text> : null}
        </Field>
        <Button ref={submitButton} type="submit" variant="primary" size="md" loading={false} disabled={busy} aria-busy={busy}
          iconOnly={false} icon={undefined} trailingIcon={undefined} className="w-full sm:w-auto"
          onKeyDown={(event) => {
            // Keep retry next in the form's keyboard path, ahead of request-id utilities.
            if (event.key === 'Tab' && !event.shiftKey && serviceError && retryButton()) { event.preventDefault(); retryButton()?.focus() }
          }}>{t(busy ? 'submitting' : 'submit')}</Button>
        <div ref={result} id="password-recovery-result" className="min-w-0 space-y-4">
          {busy ? <ListSkeleton rows={2} label={t('submitting')} className="min-w-0" /> : null}
          {ticket ? <>
            {callout('success', t('successTitle'), t('successMessage'))}
            <Section variant="plain" padding="none" divided={false} title={t('ticketTitle')} description={null} actions={null} headingLevel="h2" className="min-w-0" bodyClassName="space-y-2">
              <Text as="p" variant="supporting" tone="default" truncate={false} lineClamp={undefined}>{t('status', { status: t(`statuses.${ticket.status}`) })}</Text>
              <Text as="p" variant="supporting" tone="default" truncate={false} lineClamp={undefined}>{t('destination', { destination: ticket.maskedDestination })}</Text>
              <Text as="p" variant="supporting" tone="default" truncate={false} lineClamp={undefined}>{t('expiry')} <Timestamp value={ticket.expiresAt} format="absolute" locale={locale.language}
                relativeStyle="long" dateOptions={{ dateStyle: 'short', timeStyle: 'medium' }} tooltipOptions={{ dateStyle: 'short', timeStyle: 'medium' }}
                live={false} updateInterval={undefined} tooltip={false} fallback={t('unavailable')} now={undefined} tone="default" className="" /></Text>
            </Section>
          </> : null}
          {failure?.status === 400 ? <Alert tone="destructive" title={t('invalidTitle')} description={t('invalidMessage')} actions={null} icon={undefined}
            onDismiss={undefined} dismissLabel="" role="alert" aria-live="assertive" aria-atomic="true" className="" /> : null}
          {failure?.status === 429 ? callout('info', t('restrictedTitle'), t('restrictedMessage')) : null}
          {failure?.status === 403 ? <div role="status" aria-live="polite" aria-atomic="true">
            <NoAccessEmpty resource="" owner="" showRequestAccess={false} onRequestAccess={undefined} action={undefined} defaultRequested={false} titleAs="h2" bordered={false}
              labels={{ title: () => t('deniedTitle'), description: () => t('deniedMessage'), request: '', requested: '', sent: '' }} className="min-w-0" />{back}
          </div> : null}
          {failure?.status === 404 ? <div role="status" aria-live="polite" aria-atomic="true">
            <EmptyState title={t('missingTitle')} description={t('missingMessage')} titleAs="h2" icon={undefined} primaryAction={back} secondaryAction={null}
              size="sm" bordered={false} className="min-w-0" children={null} />
          </div> : null}
          {serviceError && failure ? <div role="alert" aria-live="assertive" aria-atomic="true"><ErrorPanel title={t('serviceTitle')} message={t('serviceMessage')}
            code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" icon={undefined} onRetry={() => submit(true)} retrying={busy} retryLabel={t('retry')}
            secondaryAction={null} titleAs="h2" announce={true} labels={{ title: '', message: '', support: '', retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'),
              requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: '' }}
            className="min-w-0 wrap-anywhere [&_code]:min-w-0 [&_code]:break-all [&_code]:whitespace-normal [&_code]:flex-1" /></div> : null}
        </div>
        {!stateLink ? back : null}
      </form>
      <Section variant="plain" padding="none" divided={false} title={t('asideTitle')} description={null} actions={null} headingLevel="h2" className="min-w-0" bodyClassName="space-y-3">
        <Text as="p" variant="supporting" tone="muted" truncate={false} lineClamp={undefined}>{t('asideDelivery')}</Text>
        <Text as="p" variant="supporting" tone="muted" truncate={false} lineClamp={undefined}>{t('asideOperator')}</Text>
      </Section>
    </div>
  </AuthLayout>
}

export default function RecoveryPage() {
  return <LiveAnnouncer className="sr-only"><Recovery /></LiveAnnouncer>
}
