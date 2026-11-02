import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, EmptyState, Field, FieldLabel, SimpleSelect, Text } from '@gntik-ai/ui'
import { assignPlan, failureFrom, getTenantPlan, type ActivePlan, type Failure } from './api'
import { FailureSurface } from './Feedback'
import type { Remote } from './remote'

// A plan assignment is a privileged write: one activation sends one POST and nothing is ever replayed
// automatically. After a network error the plan is re-read first, because the POST may have been applied.
export function AssignmentDialog({ tenantId, currentPlanId, plans, trigger, onBusyChange, onAssigned, onClose }: {
  tenantId: string
  currentPlanId: string | null
  plans: Remote<ActivePlan[]>
  trigger: RefObject<HTMLButtonElement | null>
  onBusyChange: (busy: boolean) => void
  onAssigned: (planName: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation('pages.console-tenant-plan-page')
  const id = useId()
  const [open, setOpen] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [busy, setBusy] = useState(false)
  const attempted = useRef<{ id: string; name: string } | null>(null)
  const inFlight = useRef(false)
  const needsReread = useRef(false)
  const mounted = useRef(true)
  const refocusSelect = useRef(false)
  const select = useRef<HTMLButtonElement>(null)
  const plansRetry = useRef<HTMLButtonElement>(null)
  const assignRetry = useRef<HTMLButtonElement>(null)
  const back = useRef<HTMLButtonElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const items = (plans.data ?? []).filter((plan) => plan.status === 'active')
  const ids = items.map((plan) => plan.id)
  const effective = selected && ids.includes(selected) ? selected : currentPlanId && ids.includes(currentPlanId) ? currentPlanId : ids[0] ?? ''
  const catalogReady = plans.phase === 'ready' && !plans.retrying
  const shown = failure && failure.status !== 401 ? failure : null
  const nameOf = (planId: string) => items.find((plan) => plan.id === planId)?.displayName ?? planId

  useEffect(() => {
    if (!failure || failure.status === 401) return
    ;(assignRetry.current ?? back.current ?? close.current)?.focus()
  }, [failure])
  useEffect(() => {
    if (!refocusSelect.current || plans.retrying || plans.phase === 'loading') return
    if (plans.phase !== 'ready') { refocusSelect.current = false; plansRetry.current?.focus(); return }
    // The kit select drops its disabled attribute a render after the catalogue answers, and a disabled control cannot take focus.
    let frame = 0
    let tries = 0
    const focusWhenEnabled = () => {
      const target = select.current
      if (target && !target.disabled) { refocusSelect.current = false; target.focus(); return }
      if (++tries < 30) frame = requestAnimationFrame(focusWhenEnabled)
    }
    focusWhenEnabled()
    return () => cancelAnimationFrame(frame)
  }, [plans.phase, plans.retrying, plans.data])

  const setBusyState = (value: boolean) => { setBusy(value); onBusyChange(value) }
  function finish(name: string) {
    onAssigned(name)
    if (mounted.current) setOpen(false)
  }
  async function run(retry: boolean) {
    if (inFlight.current) return
    if (!retry) {
      if (!effective || !catalogReady) return
      attempted.current = { id: effective, name: nameOf(effective) }
      needsReread.current = false
    }
    const target = attempted.current
    if (!target) return
    inFlight.current = true
    setBusyState(true)
    if (!retry) setFailure(null)
    try {
      if (needsReread.current) {
        const current = await getTenantPlan(tenantId)
        needsReread.current = false
        if (current.assignment?.planId === target.id) { finish(target.name); return }
      }
      await assignPlan(tenantId, target.id)
      finish(target.name)
    } catch (cause) {
      const next = failureFrom(cause)
      // A network error leaves the outcome unknown, so the next retry re-reads the plan first.
      if (next.status === undefined) needsReread.current = true
      if (mounted.current) setFailure(next)
    } finally {
      inFlight.current = false
      if (mounted.current) setBusyState(false)
      else onBusyChange(false)
    }
  }
  function submit(event: FormEvent) { event.preventDefault(); void run(false) }
  function chooseAgain() {
    attempted.current = null
    needsReread.current = false
    setFailure(null)
    refocusSelect.current = true
    plans.retry()
  }

  const selectDisabled = !catalogReady || items.length === 0 || busy
  const planName = attempted.current?.name ?? ''
  return <Dialog open={open} modal={true} disablePointerDismissal={busy}
    onOpenChange={(next, event) => { if (!next && inFlight.current) { event.cancel(); return } setOpen(next) }}
    onOpenChangeComplete={(next) => { if (!next) onClose() }}>
    <DialogContent size="md" presentation="responsive" showClose={false} closeLabel={t('dialog.close')} finalFocus={() => trigger.current} className="min-w-0 max-w-full wrap-anywhere">
      <DialogHeader><DialogTitle>{t('dialog.title', { tenantId })}</DialogTitle></DialogHeader>
      <form onSubmit={submit} noValidate>
        <DialogBody className="space-y-4">
          <Field invalid={false} disabled={selectDisabled} className="min-w-0">
            <FieldLabel htmlFor={`${id}-plan`}>{t('dialog.activePlan')}</FieldLabel>
            <SimpleSelect id={`${id}-plan`} triggerRef={select} value={effective} defaultValue="" aria-label={t('dialog.selectName')} placeholder={t('dialog.selectPlaceholder')}
              items={items.map((plan) => ({ value: plan.id, label: plan.displayName }))} clearable={false} size="md" disabled={selectDisabled} className="w-full min-w-0"
              onValueChange={(value) => { if (value) { setSelected(value); if (failure && !busy) setFailure(null) } }} />
          </Field>
          {(plans.phase === 'loading' || plans.failure?.status === 401) && <Text role="status" aria-live="polite" tone="muted">{t('dialog.loadingPlans')}</Text>}
          {plans.phase === 'error' && plans.failure && plans.failure.status !== 401 &&
            <FailureSurface scope="plans" failure={plans.failure} retrying={plans.retrying} onRetry={plans.retry} titleAs="h3" retryRef={plansRetry} />}
          {plans.phase === 'ready' && items.length === 0 &&
            <EmptyState title={t('dialog.noPlansTitle')} description={t('dialog.noPlansDescription')} icon={undefined} primaryAction={null} secondaryAction={null} titleAs="h3" bordered={true} className="min-w-0" />}
          {failure?.status === 401 && failure.sessionRenewed && <Alert tone="info" role="status" title={t('dialog.sessionRenewed')} description={t('dialog.sessionRenewedDescription')} actions={null} icon={undefined} onDismiss={undefined} dismissLabel={t('dialog.close')} />}
          {shown && <FailureSurface scope="assign" failure={shown} retrying={busy} onRetry={() => void run(true)} titleAs="h3" values={{ plan: planName }} retryRef={assignRetry}
            hideRetry={shown.status === 403 || shown.status === 404}
            notFoundAction={<Button ref={back} type="button" variant="secondary" onClick={chooseAgain}>{t('assign.chooseAgain')}</Button>} />}
        </DialogBody>
        <DialogFooter>
          <Button ref={close} type="button" variant="secondary" disabled={busy} onClick={() => { if (!inFlight.current) setOpen(false) }}>{t(shown ? 'dialog.close' : 'dialog.cancel')}</Button>
          {!shown && <Button type="submit" disabled={!effective || selectDisabled} aria-busy={busy}>{t(busy ? 'dialog.confirming' : 'dialog.confirm')}</Button>}
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
