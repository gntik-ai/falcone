import { useRef, useState, type RefObject } from 'react'
import { Checkbox, EmptyState, Field, FieldLabel, Input, SimpleSelect, Text, WizardLayout, useAnnounce, useToast, type StepItem } from '@gntik-ai/ui'
import { DescriptionListCard, ErrorPanel } from '@gntik-ai/blocks'
import { readConsoleShellSession } from '@in-falcone/console-api/session'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import { createIamClient, failureOf, type Failure, type IamClientData } from './api'
import { Action, Callout, focusRing, useCopy, useFailureText } from './ui'

const DENY_ACTION = 'iam.clients.manage'
// The shared permission helper returns Spanish deny text, so the page maps each of its reasons to a localized key.
const denyKey = (reason: string | null): string => {
  if (reason === null) return 'wizard.blockedFallback'
  const reasonFor = (roles: string[]) => getConsolePermissions(roles).denyReason(DENY_ACTION)
  if (reason === reasonFor(['tenant_developer'])) return 'wizard.blockedDeveloper'
  if (reason === reasonFor(['tenant_viewer'])) return 'wizard.blockedViewer'
  if (reason === reasonFor([])) return 'wizard.blockedNoRole'
  return 'wizard.blockedGeneric'
}
const TYPES = ['public', 'confidential', 'service_account'] as const
const SCOPES = ['openid', 'profile', 'email']
type Status = { state: 'idle' } | { state: 'submitting' } | { state: 'success'; clientId: string } | { state: 'error'; failure: Failure }

interface Props { workspaceId: string | null; workspaceLabel: string | null; returnFocusRef: RefObject<HTMLButtonElement | null>; onClose: () => void }

export function Wizard({ workspaceId, workspaceLabel, returnFocusRef, onClose }: Props) {
  const { t } = useCopy()
  const announce = useAnnounce(), toast = useToast(), failureText = useFailureText()
  // Permissions are re-read from the persisted session when the wizard opens (legacy useWizardPermissionCheck).
  const [roles] = useState(() => readConsoleShellSession()?.principal?.platformRoles ?? [])
  const permissions = getConsolePermissions(roles)
  const allowed = permissions.can(DENY_ACTION)
  const [current, setCurrent] = useState(0)
  const [data, setData] = useState<IamClientData>({ clientType: 'public', clientId: '', redirectUris: '', scopes: [] })
  const [validation, setValidation] = useState<{ step: number; message: string } | null>(null)
  const [status, setStatus] = useState<Status>({ state: 'idle' })
  const inFlight = useRef(false)
  const labels = [t('wizard.steps.workspace'), t('wizard.steps.type'), t('wizard.steps.redirects'), t('wizard.steps.scopes'), t('wizard.steps.review')]
  const submitting = status.state === 'submitting', done = status.state === 'success'
  const typeLabel = t(`wizard.types.${data.clientType}`)

  if (!allowed) {
    return <section aria-label={t('wizard.blockedTitle')} className="min-w-0 space-y-3" data-testid="auth-wizard-blocked">
      <EmptyState icon={undefined} title={t('wizard.blockedTitle')} description={t(denyKey(permissions.denyReason(DENY_ACTION)))} secondaryAction={null} titleAs="h2" bordered={false} className="min-w-0"
        primaryAction={<Action onClick={() => { onClose(); requestAnimationFrame(() => returnFocusRef.current?.focus()) }}>{t('wizard.close')}</Action>} />
    </section>
  }

  function check(step: number): string {
    if (step === 0 && !workspaceId) return t('wizard.validation.workspace')
    if (step === 1 && !data.clientId.trim()) return t('wizard.validation.clientId')
    if (step === 2 && data.clientType !== 'service_account' && !data.redirectUris.includes('://')) return t('wizard.validation.redirects')
    return ''
  }
  function move(next: number) {
    if (submitting || done) return
    const message = next > current ? check(current) : ''
    setValidation(message ? { step: current, message } : null)
    if (message) return
    setCurrent(next); setStatus({ state: 'idle' })
  }
  async function submit() {
    if (inFlight.current || done || current !== 4 || !workspaceId) return
    inFlight.current = true; setStatus({ state: 'submitting' })
    try {
      const clientId = await createIamClient(workspaceId, data)
      const message = clientId ? t('wizard.created', { id: clientId }) : t('wizard.createdGeneric')
      setStatus({ state: 'success', clientId })
      toast.add({ title: message, description: undefined, tone: 'success', priority: 'low' }); announce(message, 'polite')
    } catch (cause) {
      const failure = failureOf(cause)
      setStatus({ state: 'error', failure }); announce(failureText(failure, t('wizard.failureFallback')), 'assertive')
    } finally { inFlight.current = false }
  }
  const steps: StepItem[] = labels.map((label, index) => ({ id: String(index), label, description: null, status: validation?.step === index ? 'error' : index < current ? 'complete' : index === current ? 'current' : 'upcoming' }))
  const review = [
    { id: 'workspace', label: t('wizard.steps.workspace'), value: workspaceLabel ?? workspaceId ?? t('wizard.noWorkspace') },
    { id: 'type', label: t('wizard.fields.type'), value: typeLabel },
    { id: 'clientId', label: t('wizard.fields.clientId'), value: data.clientId, mono: true },
    { id: 'redirects', label: t('wizard.steps.redirects'), value: data.redirectUris || '—' },
    { id: 'scopes', label: t('wizard.steps.scopes'), value: data.scopes.join(', ') || '—' },
  ]
  const failure = status.state === 'error' ? status.failure : null
  const failureMessage = failure ? failureText(failure, t('wizard.failureFallback')) : ''

  return <WizardLayout mode="overlay" size="fullscreen" open={true} onOpenChange={(open) => { if (!open) onClose() }} description={t('wizard.description')} returnFocusRef={returnFocusRef} closeOnInteractOutside={false}
    cancelLabel={t('form.cancel')} stepsSummaryLabel={t('wizard.stepsLabel')} stepAnnouncement={({ position, total }) => t('wizard.stepCount', { step: position, total, label: labels[position - 1] })}
    steps={steps} stepsInteractive={false} stepStatusText={{ complete: t('wizard.stepComplete'), current: t('wizard.stepCurrent'), upcoming: t('wizard.stepUpcoming'), error: t('wizard.stepError') }}
    formatStepCount={(step, total) => t('wizard.stepCount', { step, total, label: labels[step - 1] })} current={current} onStepChange={move} onFinish={() => void submit()} onExit={undefined}
    title={<span className={focusRing}>{t('wizard.title')}</span>} logo={null} footerStart={null}
    footer={<footer className="flex flex-wrap justify-end gap-3 border-t border-border p-4">{done ? <Action variant="primary" onClick={onClose}>{t('wizard.close')}</Action> : <>
      <Action disabled={submitting || current === 0} onClick={() => move(current - 1)}>{t('wizard.back')}</Action>
      {current < 4 ? <Action variant="primary" onClick={() => move(current + 1)}>{t('wizard.next')}</Action> : <Action variant="primary" loading={submitting} disabled={submitting} focusableWhenDisabled={true} onClick={() => void submit()}>{t(submitting ? 'wizard.confirming' : 'wizard.confirm')}</Action>}</>}</footer>}
    backLabel={t('wizard.back')} backDisabled={submitting} nextLabel={t('wizard.next')} finishLabel={t('wizard.confirm')} nextDisabled={submitting} nextLoading={submitting} finishPending={submitting} pendingLabel={t('wizard.confirming')} exitLabel={t('wizard.exit')}
    confirmExit={false} exitTitle={t('wizard.exit')} exitDescription={t('wizard.description')} exitConfirmLabel={t('wizard.exit')} exitCancelLabel={t('form.cancel')} stepsLabel={t('wizard.stepsLabel')} width="default" mainId="auth-wizard-main" skipLinkLabel={t('wizard.skip')}
    fullScreen={true} className="h-full min-w-0 wrap-anywhere" data-testid="auth-wizard">
    <div className="min-w-0 space-y-4">
      {done ? <Callout tone="success" message={status.clientId ? t('wizard.created', { id: status.clientId }) : t('wizard.createdGeneric')} /> : <>
        {current === 0 && <Field invalid={validation?.step === 0}><FieldLabel htmlFor="auth-wizard-workspace" required={false}>{t('wizard.steps.workspace')}</FieldLabel><Input id="auth-wizard-workspace" readOnly value={workspaceLabel ?? workspaceId ?? t('wizard.noWorkspace')} className={`min-w-0 ${focusRing}`} /></Field>}
        {current === 1 && <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <SimpleSelect label={t('wizard.fields.type')} value={data.clientType} items={TYPES.map((value) => ({ value, label: t(`wizard.types.${value}`) }))} onValueChange={(value) => { if (value) setData({ ...data, clientType: value }) }}
            placeholder={undefined} clearable={false} clearLabel={t('clear')} onClear={undefined} size="md" disabled={false} loadOptions={undefined} loadingText={t('loading')} errorText={t('optionsFailure')} emptyText={t('noOptions')} className={`w-full min-w-0 ${focusRing}`} />
          <Field invalid={validation?.step === 1}><FieldLabel htmlFor="auth-wizard-client-id" required={true}>{t('wizard.fields.clientId')}</FieldLabel><Input id="auth-wizard-client-id" value={data.clientId} onValueChange={(value) => setData({ ...data, clientId: String(value) })} autoComplete="off" spellCheck={false} invalid={validation?.step === 1} className={`min-w-0 ${focusRing}`} /></Field>
        </div>}
        {current === 2 && <Field invalid={validation?.step === 2}><FieldLabel htmlFor="auth-wizard-redirects" required={data.clientType !== 'service_account'}>{t('wizard.steps.redirects')}</FieldLabel><Input id="auth-wizard-redirects" value={data.redirectUris} onValueChange={(value) => setData({ ...data, redirectUris: String(value) })} placeholder={t('wizard.redirectsPlaceholder')} autoComplete="off" spellCheck={false} invalid={validation?.step === 2} className={`min-w-0 ${focusRing}`} /></Field>}
        {current === 3 && <fieldset className="min-w-0 space-y-2"><legend className="text-sm font-medium text-foreground">{t('wizard.steps.scopes')}</legend>
          {SCOPES.map((scope) => <Checkbox key={scope} label={scope} checked={data.scopes.includes(scope)} onCheckedChange={(next) => setData({ ...data, scopes: next === true ? [...data.scopes, scope] : data.scopes.filter((item) => item !== scope) })} />)}</fieldset>}
        {current === 4 && <DescriptionListCard title={t('wizard.review')} description={t('wizard.reviewHelp')} titleAs="h2" wrap={true} columns={1} onEdit={undefined} onCopy={undefined} editLabel={t('wizard.back')}
          labels={{ title: t('wizard.review'), description: t('wizard.reviewHelp'), edit: t('wizard.back'), copy: () => t('wizard.copy'), copied: () => t('wizard.copied'), copiedToClipboard: t('wizard.copied') }}
          items={review.map((item) => ({ ...item, mono: item.mono ?? false, render: undefined, status: undefined, copyable: false, copyValue: '' }))} />}
        {validation && validation.step === current && <Callout message={validation.message} />}
        {failure && <ErrorPanel title={t('wizard.failureTitle')} message={failureMessage} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" secondaryAction={null} titleAs="h3" announce={false}
          retryLabel={t('failure.retry')} retrying={submitting} onRetry={() => void submit()} className="min-w-0"
          labels={{ title: t('wizard.failureTitle'), message: failureMessage, support: t('failure.support'), retry: t('failure.retry'), retrying: t('failure.retrying'), retryingStatus: t('failure.retrying'), requestId: t('failure.requestId'), copyRequestId: t('failure.copyRequestId'), copied: t('failure.copied'), requestIdCopied: t('failure.requestIdCopied'), details: t('failure.details') }} />}
      </>}
      {!done && current === 4 && <Text as="p" variant="body" tone="muted">{t('wizard.secretNote')}</Text>}
    </div>
  </WizardLayout>
}
