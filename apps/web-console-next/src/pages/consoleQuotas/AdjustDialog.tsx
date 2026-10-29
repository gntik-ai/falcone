import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldDescription, FieldLabel, Input, Link, Text, useAnnounce, useToast } from '@gntik-ai/ui'
import { InlineCallout } from '@gntik-ai/blocks'
import { getQuotaTenantPlan, setQuotaPlanLimit } from '@in-falcone/console-api/clients'
import type { Dimension } from './posture'

function errorMessage(cause: unknown, fallback: string) {
  const message = (cause as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : fallback
}
export interface AdjustTarget { tenantId: string; dimension: Dimension; key: string }
type Resolution = { state: 'resolving' } | { state: 'no-plan' } | { state: 'plan-error'; message: string } | { state: 'ready' | 'frozen'; planId: string; name: string }
export function AdjustDialog({ target, onClose, onAdjusted }: { target: AdjustTarget; onClose: () => void; onAdjusted: () => void }) {
  const { t } = useTranslation('pages.console-quotas-page')
  const announce = useAnnounce()
  const toast = useToast()
  const [resolution, setResolution] = useState<Resolution>({ state: 'resolving' })
  const [attempt, setAttempt] = useState(0)
  const [value, setValue] = useState(String(target.dimension.hardLimit ?? -1))
  const [invalid, setInvalid] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [saved, setSaved] = useState<number | null>(null)
  const [open, setOpen] = useState(true)
  const input = useRef<HTMLInputElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const id = useId()
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let active = true
    void getQuotaTenantPlan(target.tenantId).then((data) => {
      if (!active) return
      const planId = data.assignment?.planId ?? data.plan?.id
      if (data.noAssignment || !planId || !data.plan) { setResolution({ state: 'no-plan' }); return }
      setResolution({ state: ['deprecated', 'archived'].includes(data.plan.status ?? '') ? 'frozen' : 'ready', planId, name: data.plan.displayName ?? planId })
    }).catch((cause: unknown) => {
      if (active) setResolution({ state: 'plan-error', message: errorMessage(cause, t('planErrorDescription')) })
    })
    return () => { active = false }
  }, [target.tenantId, attempt, t])
  useEffect(() => {
    if (saved !== null || ['plan-error', 'no-plan', 'frozen'].includes(resolution.state)) closeButton.current?.focus()
    else if (resolution.state === 'ready') {
      if (confirm) confirmButton.current?.focus()
      else input.current?.focus()
    }
  }, [resolution.state, confirm, saved])
  const limit = (number: number | null) => number === null || number === -1 ? t('unlimited') : String(number)
  const planName = 'name' in resolution ? resolution.name : ''
  const variables = { dimension: target.dimension.displayName, plan: planName, value: limit(saved) }
  function close() { if (!inFlight.current) setOpen(false) }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current || resolution.state !== 'ready') return
    const parsed = Number(value.trim())
    if (!value.trim() || !Number.isInteger(parsed) || parsed < -1) { setInvalid(true); input.current?.focus(); return }
    setInvalid(false); setFailure(null); setConfirm(true)
  }
  async function save() {
    if (inFlight.current || !confirm || resolution.state !== 'ready') return
    inFlight.current = true; setBusy(true); setFailure(null)
    try {
      const result = await setQuotaPlanLimit(resolution.planId, target.dimension.dimensionId, Number(value))
      if (!mounted.current) return
      setSaved(result.newValue)
      toast.add({ title: t('saved'), description: undefined, tone: 'success', priority: 'low' })
      announce(t('saved'), 'polite')
      onAdjusted()
    } catch (cause) {
      if (!mounted.current) return
      const code = (cause as { code?: string } | null)?.code
      const message = errorMessage(cause, t('requestFailed'))
      setFailure(code === 'INVALID_LIMIT_VALUE' ? t('invalidServer') : code === 'PLAN_LIMITS_FROZEN' ? t('frozenServer') : code && !message.includes(code) ? `${code}: ${message}` : message)
      setConfirm(false)
    } finally { inFlight.current = false; if (mounted.current) setBusy(false) }
  }
  return <Dialog open={open} modal={true} disablePointerDismissal={busy}
    onOpenChange={(next, event) => { if (!next && inFlight.current) { event.cancel(); return } setOpen(next) }}
    onOpenChangeComplete={(next) => { if (!next) onClose() }}>
    <DialogContent ref={panel} size="md" presentation="responsive" showClose={false} closeLabel={t('close')}
      initialFocus={() => panel.current} finalFocus={() => Array.from(document.querySelectorAll<HTMLElement>('[data-quota-adjust-trigger]')).find((node) => node.dataset.quotaAdjustTrigger === target.key) ?? null}
      className="min-w-0 max-w-full wrap-anywhere">
      <DialogHeader><DialogTitle>{t('adjustTitle', variables)}</DialogTitle><DialogDescription>{t('adjustDescription')}</DialogDescription></DialogHeader>
      <DialogBody className="space-y-4">
        {saved !== null ? <><Alert tone="success" role="status" title={t('saved')} description={t('savedDescription', variables)} actions={null} icon={undefined} onDismiss={undefined} dismissLabel={t('close')} />
          <DialogFooter><Button ref={closeButton} type="button" onClick={close}>{t('close')}</Button></DialogFooter></> :
          resolution.state === 'resolving' ? <Text role="status" aria-live="polite">{t('resolving')}</Text> :
          resolution.state === 'plan-error' ? <><Alert tone="destructive" role="alert" title={t('planError')} description={resolution.message} actions={null} icon={undefined} onDismiss={undefined} dismissLabel={t('close')} />
            <DialogFooter><Button ref={closeButton} type="button" variant="secondary" onClick={close}>{t('close')}</Button><Button type="button" onClick={() => { setResolution({ state: 'resolving' }); setAttempt((count) => count + 1) }}>{t('retry')}</Button></DialogFooter></> :
          resolution.state === 'no-plan' || resolution.state === 'frozen' ? <><Text>{t(resolution.state === 'no-plan' ? 'noPlan' : 'frozen', variables)}</Text>
            <DialogFooter><Button ref={closeButton} type="button" variant="secondary" onClick={close}>{t('close')}</Button>
              <Link href={resolution.state === 'no-plan' ? `/console/tenants/${target.tenantId}/plan` : `/console/plans/${resolution.planId}`} underline="always" external={false} externalLabel="">{t(resolution.state === 'no-plan' ? 'assignPlan' : 'openPlan')}</Link></DialogFooter></> :
          <form onSubmit={submit} noValidate className="space-y-4">
            <InlineCallout tone="warning" title={t('planWideTitle')} description={t('planWideDescription', variables)} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined}
              labels={{ title: t('planWideTitle'), description: t('planWideDescription', variables), upgrade: '', viewUsage: '' }} />
            <Text>{t('currentValue', { value: limit(target.dimension.hardLimit) })}</Text>
            {confirm ? <Text>{t('confirmDescription', { ...variables, value: limit(Number(value)) })}</Text> :
              <Field invalid={invalid} disabled={busy}>
                <FieldLabel htmlFor={id}>{t('newLimit', variables)}</FieldLabel>
                <Input ref={input} id={id} type="number" inputMode="numeric" min={-1} step={1} autoComplete="off" value={value} disabled={busy}
                  aria-invalid={invalid} aria-describedby={`${id}-help${invalid ? ` ${id}-error` : ''}`} onChange={(event) => { setValue(event.currentTarget.value); setInvalid(false) }} />
                <FieldDescription id={`${id}-help`}>{t('limitHelp')}</FieldDescription>
                {invalid && <Text id={`${id}-error`} role="alert" tone="destructive">{t('invalid')}</Text>}
              </Field>}
            {failure && <Alert tone="destructive" role="alert" title={t('saveError')} description={failure} actions={null} icon={undefined} onDismiss={undefined} dismissLabel={t('close')} />}
            <DialogFooter>
              <Button type="button" variant="secondary" disabled={busy} onClick={close}>{t('cancel')}</Button>
              {confirm && <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirm(false)}>{t('back')}</Button>}
              {confirm ? <Button ref={confirmButton} type="button" disabled={busy} aria-busy={busy} onClick={() => void save()}>{t(busy ? 'saving' : 'confirm')}</Button>
                : <Button type="submit" disabled={busy}>{t('save')}</Button>}
            </DialogFooter>
          </form>}
      </DialogBody>
    </DialogContent>
  </Dialog>
}
