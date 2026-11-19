import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Checkbox, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, Link, SimpleSelect, Stepper, Text, useToast } from '@gntik-ai/ui'
import { ErrorPanel, InlineCallout, NoAccessEmpty, ValidationSummary } from '@gntik-ai/blocks'
import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import { useConsoleContext } from '../../shell/context'
import { usePermissions } from '../../shell/permissions'
import { Action, Details, Empty, Heading, TextField, retryButton } from './States'
import { useCopy, focusRing } from './copy'
import { IN_PROGRESS_DELAY_MS, IN_PROGRESS_RETRIES, newKey, send, type DbForm, type Engine, type Outcome } from './submit'

type Posture = { dimensions?: { dimensionId: string; hardLimit?: number | null; measuredValue?: number }[]; hardLimitBreaches?: string[] }

// Legacy useWizardQuotaCheck: an unavailable posture counts as available, the platform tenant is never limited.
function useQuota(tenant: string | null, workspace: string | null) {
  const [available, setAvailable] = useState(true)
  useEffect(() => {
    let live = true
    async function check() {
      if (!tenant) return
      try {
        await Promise.all([requestConsoleSessionJson(`/v1/metrics/tenants/${tenant}/quotas`), requestConsoleSessionJson(`/v1/metrics/tenants/${tenant}/overview`)])
        if (!workspace) return
        const [posture, overview] = await Promise.all([
          requestConsoleSessionJson<Posture>(`/v1/metrics/workspaces/${workspace}/quotas`),
          requestConsoleSessionJson<{ hardLimitDimensions?: string[] }>(`/v1/metrics/workspaces/${workspace}/overview`),
        ])
        const dimension = posture.dimensions?.find((item) => item.dimensionId === 'databases.count')
        const exceeded = dimension && ((dimension.hardLimit != null && dimension.hardLimit > 0 && Math.round(((dimension.measuredValue ?? 0) / dimension.hardLimit) * 100) >= 100) || [...(posture.hardLimitBreaches ?? []), ...(overview.hardLimitDimensions ?? [])].includes('databases.count'))
        if (live) setAvailable(tenant === 'platform' || !exceeded)
      } catch { /* Legacy treats an unavailable quota check as available. */ }
    }
    void check()
    return () => { live = false }
  }, [tenant, workspace])
  return available
}

export function Wizard({ close, opener, onReplayUnavailable }: { close: () => void; opener: () => HTMLElement | null; onReplayUnavailable: () => void }) {
  const { t } = useCopy(), { activeTenantId, activeWorkspaceId } = useConsoleContext(), { can, denyReason } = usePermissions(), toast = useToast()
  const [open, setOpen] = useState(true), [step, setStep] = useState(0)
  const [form, setForm] = useState<DbForm>({ engine: 'mongodb', name: '', items: [] })
  const [busy, setBusy] = useState(false), [waiting, setWaiting] = useState(false)
  const [outcome, setOutcome] = useState<Exclude<Outcome, { kind: 'success' | 'aborted' }> | null>(null), [result, setResult] = useState<{ databaseId: string; engine: Engine } | null>(null)
  const quota = useQuota(activeTenantId, activeWorkspaceId)
  // One key per submitted form state. Any edit drops it; a retry of the same state reuses it.
  const key = useRef<{ value: string; fingerprint: string } | null>(null)
  const autoLeft = useRef(IN_PROGRESS_RETRIES), timer = useRef<number | null>(null), controller = useRef<AbortController | null>(null)
  const sending = useRef(false), live = useRef(true), retried = useRef(false), lastKind = useRef<string | null>(null)
  const box = useRef<HTMLDivElement>(null), resultHeading = useRef<HTMLDivElement>(null)
  const allowed = can('workspace.write'), denial = denyReason('workspace.write')
  const denialKey = denial?.includes('Developer') ? 'developer' : denial?.includes('Viewer') ? 'viewer' : denial?.includes('Tu rol actual') ? 'generic' : 'unknown'
  const forbidden = outcome?.kind === 'forbidden'
  // Ordinary 409 and 422 outcomes (not IN_PROGRESS or KEY_MISMATCH) are final: only Cerrar remains.
  const closeOnly = Boolean(result) || outcome?.kind === 'replay-unavailable' || outcome?.kind === 'conflict' || outcome?.kind === 'invalid'
  const terminal = closeOnly || forbidden
  const validation = step === 0 && !activeWorkspaceId ? t('wizard.workspaceMissing') : step === 1 && !form.name.trim() ? t('wizard.nameRequired') : step === 1 && !quota ? t('wizard.quotaExhausted') : null

  function cancel() {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null; controller.current?.abort(); setWaiting(false)
  }
  useEffect(() => { live.current = true; return () => { live.current = false; cancel() } }, [])
  function edit(patch: Partial<DbForm>) { cancel(); key.current = null; setOutcome(null); setForm((current) => ({ ...current, ...patch })) }
  function move(next: number) { cancel(); setOutcome(null); setStep(next) }

  async function submit() {
    if (sending.current || !allowed || !activeWorkspaceId || !form.name.trim() || !quota) return
    const fingerprint = JSON.stringify([activeWorkspaceId, form])
    if (!key.current || key.current.fingerprint !== fingerprint) { key.current = { value: newKey(), fingerprint }; autoLeft.current = IN_PROGRESS_RETRIES }
    const own = new AbortController(), used = key.current.value
    controller.current = own; sending.current = true; setBusy(true)
    const next = await send(activeWorkspaceId, form, used, own.signal)
    sending.current = false
    if (!live.current || own.signal.aborted || next.kind === 'aborted') return
    setBusy(false)
    if (next.kind === 'success') {
      key.current = null; setOutcome(null); setResult({ databaseId: next.databaseId, engine: form.engine })
      toast.add({ title: t('wizard.created'), description: undefined, tone: 'success', priority: 'low' })
      return
    }
    if (next.kind === 'mismatch' || next.kind === 'invalid-key') key.current = null
    if (next.kind === 'replay-unavailable') onReplayUnavailable()
    setOutcome(next)
    if (next.kind === 'progress' && autoLeft.current > 0) {
      autoLeft.current--; setWaiting(true)
      timer.current = window.setTimeout(() => { timer.current = null; if (!live.current) return; setWaiting(false); void submit() }, IN_PROGRESS_DELAY_MS)
    }
  }
  const confirm = () => { retried.current = false; void submit() }
  const retry = () => { retried.current = true; void submit() }

  // A failure that offers Reintentar keeps focus there after a failed retry; every other new state takes focus itself.
  useEffect(() => {
    if (result) { resultHeading.current?.focus(); return }
    if (!outcome) { lastKind.current = null; return }
    const previous = lastKind.current
    lastKind.current = outcome.kind
    const offersRetry = outcome.kind === 'retry' || outcome.kind === 'invalid-key' || (outcome.kind === 'progress' && autoLeft.current === 0)
    if (outcome.kind === 'progress' && previous === 'progress' && autoLeft.current > 0) return
    if (retried.current && offersRetry) (retryButton(box.current, t('retry')) ?? box.current)?.focus()
    else box.current?.focus()
  }, [outcome, result])

  // A collection name is shown with its kind so a bare name never stands in for localized copy; extensions stay literal.
  const itemLabel = (item: string) => (form.engine === 'postgresql' ? item : t('wizard.collectionOption', { name: item }))
  const summary = [{ id: 'workspace', term: t('wizard.workspace'), value: activeWorkspaceId ?? '' }, { id: 'engine', term: t('wizard.engine'), value: t(`wizard.${form.engine}`) }, { id: 'name', term: t('wizard.name'), value: form.name }, { id: 'config', term: t('wizard.initialConfig'), value: form.items.map(itemLabel).join(', ') || t('wizard.notConfigured') }]
  const manualRetry = () => <Action busy={busy} onClick={retry}>{t(busy ? 'wizard.confirming' : 'retry')}</Action>
  const callout = (tone: 'info' | 'warning' | 'destructive', title: string, description: string, extra: ReactNode = null) => (
    <div ref={box} tabIndex={-1} className={`min-w-0 space-y-3 ${focusRing}`} data-testid="mongo-wizard-outcome">
      <InlineCallout tone={tone} title={title} description={description} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" labels={{ title: '', description: '', upgrade: '', viewUsage: '' }} />{extra}
    </div>)
  const panel = (message: string) => outcome && 'failure' in outcome ? (
    <div ref={box} tabIndex={-1} className={`min-w-0 ${focusRing}`} data-testid="mongo-wizard-outcome">
      <ErrorPanel title={t('wizard.submitErrorTitle')} message={message} code={outcome.failure.status ?? null} requestId={outcome.failure.requestId ?? ''} details="" secondaryAction={null} titleAs="h3" announce={true} onRetry={retry} retrying={busy} retryLabel={t('retry')} className="min-w-0"
        labels={{ title: t('wizard.submitErrorTitle'), message, support: t('support'), retry: t('retry'), retrying: t('wizard.confirming'), retryingStatus: t('wizard.confirming'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }} />
    </div>) : null
  const engineLink = (to: string, label: string) => <Link render={<RouterLink to={to} onClick={() => setOpen(false)} />} tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{label}</Link>
  const failureView = () => {
    if (!outcome) return null
    switch (outcome.kind) {
      case 'retry': return panel(t(outcome.failure.status ? 'serverError' : 'networkError'))
      case 'invalid-key': return panel(t('wizard.requestNotSent'))
      case 'progress': return callout('info', t('wizard.titleInProgress'), t('wizard.inProgress'), autoLeft.current === 0 && !waiting ? manualRetry() : null)
      case 'replay-unavailable': return callout('warning', t('wizard.titleReplayUnavailable'), t('wizard.replayUnavailable'), engineLink('/console/postgres', t('wizard.openEngine')))
      case 'mismatch': return callout('warning', t('wizard.titleMismatch'), t('wizard.mismatch'))
      case 'conflict': return callout('destructive', t('wizard.titleConflict'), t('wizard.conflict'))
      case 'invalid': return callout('destructive', t('wizard.titleConflict'), t('wizard.invalidData'))
      case 'expired': return callout('destructive', t('wizard.titleConflict'), t('wizard.submit401'))
      case 'rejected': return callout('destructive', t('wizard.titleConflict'), t('wizard.failed'))
      case 'forbidden': return <div ref={box} tabIndex={-1} className={`min-w-0 ${focusRing}`} data-testid="mongo-wizard-outcome"><NoAccessEmpty resource={t('wizard.noAccessTitle')} owner="" onRequestAccess={undefined} showRequestAccess={false} action={undefined} defaultRequested={false} titleAs="h3" bordered={false} className="min-w-0" labels={{ title: () => t('wizard.noAccessTitle'), description: () => t('wizard.submit403'), request: '', requested: '', sent: '' }} /></div>
    }
  }

  return <Dialog open={open} modal={true} disablePointerDismissal={true} onOpenChange={(next, event) => { if (busy) event.cancel(); else { if (!next) cancel(); setOpen(next) } }} onOpenChangeComplete={(next) => { if (!next) close() }}>
    <DialogContent size="md" presentation="responsive" showClose={true} closeLabel={t('close')} container={undefined} keepMounted={false} initialFocus={true} finalFocus={() => { const node = opener(); return node?.isConnected ? node : document.getElementById('mongo-heading') }} className="min-w-0 max-w-full wrap-anywhere" data-testid="mongo-wizard">
      <DialogHeader><DialogTitle>{t('newDatabase')}</DialogTitle><DialogDescription>{t('wizard.description')}</DialogDescription></DialogHeader>
      <DialogBody className="min-w-0 space-y-4">
        {!allowed ? <Empty title={t('wizard.blocked')} description={t(`permissionReasons.${denialKey}`)} /> : <>
          <Stepper steps={['workspace', 'engine', 'config', 'review'].map((id) => ({ id, label: t(`wizard.${id}`), description: undefined, status: undefined }))} current={step} orientation="vertical" compact={false} onStepClick={undefined} label={t('newDatabase')} statusText={{ complete: t('wizard.complete'), current: t('wizard.current'), upcoming: t('wizard.upcoming'), error: t('wizard.invalid') }} formatCount={(current, total) => t('wizard.stepCount', { step: current, total })} className="min-w-0" />
          {validation && <ValidationSummary title={t('wizard.validation')} errors={[{ fieldId: step === 0 ? 'mongo-wizard-workspace' : 'mongo-wizard-name', message: validation }]} submitCount={0} labels={{ title: () => t('wizard.validation') }} className="min-w-0" />}
          {step === 0 && <div id="mongo-wizard-workspace"><Details term={t('wizard.workspace')} value={activeWorkspaceId || t('noneWorkspace')} /></div>}
          {step === 1 && <>
            <Field invalid={false} disabled={busy} className="min-w-0"><FieldLabel htmlFor="mongo-engine">{t('wizard.engine')}</FieldLabel><SimpleSelect id="mongo-engine" value={form.engine} defaultValue="mongodb" placeholder={t('wizard.selectEngine')} clearable={false} size="md" items={(['postgresql', 'mongodb'] as const).map((value) => ({ value, label: t(`wizard.${value}`) }))} onValueChange={(value) => { if (value) edit({ engine: value as Engine, items: [] }) }} className={`w-full min-w-0 ${focusRing}`} /></Field>
            <TextField id="mongo-wizard-name" label={t('wizard.name')} placeholder={t('wizard.namePlaceholder')} value={form.name} onChange={(name) => edit({ name })} busy={busy} />
          </>}
          {step === 2 && <><Text as="p" variant="label" tone="default">{t(form.engine === 'postgresql' ? 'wizard.extensions' : 'wizard.collections')}</Text>{(form.engine === 'postgresql' ? ['uuid-ossp', 'pgcrypto'] : ['users', 'orders']).map((item) => <Checkbox key={item} label={itemLabel(item)} description={undefined} checked={form.items.includes(item)} defaultChecked={false} disabled={false} indeterminate={false} onCheckedChange={(checked) => edit({ items: checked ? [...form.items, item] : form.items.filter((value) => value !== item) })} className={focusRing} />)}</>}
          {step === 3 && <section className="min-w-0 space-y-3" aria-label={t('wizard.review')}><Heading title={t('wizard.review')} level="h3" />{summary.map((item) => <Details key={item.id} term={item.term} value={item.value} />)}</section>}
          {step === 3 && !result && failureView()}
          {result && <div ref={resultHeading} tabIndex={-1} role="status" className={`min-w-0 space-y-2 ${focusRing}`} data-testid="mongo-wizard-result"><Heading title={t('wizard.created')} level="h3" /><Details term={t('wizard.resourceId')} value={result.databaseId} />{engineLink(result.engine === 'mongodb' ? '/console/mongo' : '/console/postgres', t(result.engine === 'mongodb' ? 'wizard.openMongo' : 'wizard.openPostgres'))}</div>}
        </>}
      </DialogBody>
      <DialogFooter className="flex-wrap gap-2">
        <Action disabled={busy} onClick={() => { if (step === 0 || !allowed || terminal) { cancel(); setOpen(false) } else move(step - 1) }}>{t(terminal ? 'close' : step === 0 || !allowed ? 'cancel' : 'previous')}</Action>
        {allowed && !closeOnly && (step < 3 ? <Action variant="primary" disabled={Boolean(validation)} onClick={() => move(step + 1)}>{t('next')}</Action> : <Action id="mongo-wizard-confirm" variant="primary" busy={busy} disabled={forbidden || waiting || !quota || !activeWorkspaceId || !form.name.trim()} onClick={confirm}>{t(busy ? 'wizard.confirming' : 'wizard.confirm')}</Action>)}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
