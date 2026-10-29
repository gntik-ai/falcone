import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldError, FieldLabel, Input, Link, SimpleSelect, Stepper, Text, useAnnounce, useToast } from '@gntik-ai/ui'
import { DescriptionListCard, NoAccessEmpty } from '@gntik-ai/blocks'
import { createRequestId } from '@in-falcone/console-api/http'
import { useConsoleContext } from '../../shell/context'
import { Feedback } from './Feedback'
import { createTenant, failureOf, listActivePlans, type ActivePlan, type Failure, type TenantBody } from './api'

export function Wizard({ allowed, superadmin, close, trigger, precheck, retryPrecheck }: {
  allowed: boolean; superadmin: boolean; close: () => void; trigger: RefObject<HTMLButtonElement | null>; precheck: Failure | null; retryPrecheck: () => void
}) {
  const { t } = useTranslation('pages.console-tenants-page')
  const { reloadTenants } = useConsoleContext()
  const announce = useAnnounce()
  const toast = useToast()
  const [open, setOpen] = useState(true)
  const [step, setStep] = useState(0)
  const [values, setValues] = useState({ name: '', planId: '', region: '', locale: 'es' })
  const [invalid, setInvalid] = useState(false)
  const [catalog, setCatalog] = useState<{ items: ActivePlan[]; loading: boolean; failure: Failure | null }>({ items: [], loading: true, failure: null })
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  const catalogRequest = useRef<{ attempt: number; promise: ReturnType<typeof listActivePlans> } | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const attempt = useRef<{ key: string; body: TenantBody } | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(false)
  const panel = useRef<HTMLDivElement>(null)
  const stepBody = useRef<HTMLDivElement>(null)
  const steps = ['nameStep', 'planStep', 'regionStep', 'summary']
  const catalogBlocked = catalog.loading || Boolean(catalog.failure) || !catalog.items.length
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!allowed) return
    let cancelled = false
    setCatalog({ items: [], loading: true, failure: null })
    if (catalogRequest.current?.attempt !== catalogAttempt) catalogRequest.current = { attempt: catalogAttempt, promise: listActivePlans() }
    void catalogRequest.current.promise.then((result) => {
      if (!cancelled) setCatalog({ items: result.items, loading: false, failure: null })
    }).catch((cause) => { if (!cancelled) setCatalog({ items: [], loading: false, failure: failureOf(cause) }) })
    return () => { cancelled = true }
  }, [allowed, catalogAttempt])
  useEffect(() => { stepBody.current?.querySelector<HTMLElement>('input, button, h2')?.focus() }, [step])
  function dismiss() { if (!inFlight.current) setOpen(false) }
  function edit(field: keyof typeof values, value: string) {
    if (inFlight.current) return
    setValues((previous) => ({ ...previous, [field]: value })); setInvalid(false); setFailure(null); attempt.current = null
  }
  function next() {
    const valid = step === 0 ? Boolean(values.name.trim()) : step === 1 ? !catalogBlocked && catalog.items.some((plan) => plan.id === values.planId) : ['eu-west', 'us-east'].includes(values.region)
    setInvalid(!valid)
    if (valid) setStep((value) => value + 1)
    else stepBody.current?.querySelector<HTMLElement>('input, button')?.focus()
  }
  function back() {
    if (inFlight.current) return
    if (failure?.status === 404) setCatalogAttempt((count) => count + 1)
    attempt.current = null; setFailure(null); setInvalid(false); setStep((value) => Math.max(0, value - 1))
  }
  async function submit() {
    if (inFlight.current || !allowed || created) return
    inFlight.current = true; setBusy(true)
    const retained = attempt.current ?? { key: createRequestId('idem'), body: { name: values.name, planId: values.planId, region: values.region, preferences: { locale: values.locale } } }
    attempt.current = retained
    try {
      const result = await createTenant(retained.body, retained.key)
      if (!mounted.current) return
      setCreated(result.tenantId); setFailure(null)
      announce(t('success'), 'polite'); toast.add({ title: t('success'), description: undefined, tone: 'success', priority: 'low' })
      void reloadTenants?.()
    } catch (cause) {
      if (mounted.current) { const error = failureOf(cause); setFailure(error); if (error.status !== 401) toast.add({ title: t('submit.error'), description: undefined, tone: 'destructive', priority: 'low' }) }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false) }
  }
  const retrySubmit = failure && ![401, 403, 404].includes(failure.status ?? 0)
  const summary = ['name', 'planId', 'region', 'locale'].map((field) => ({ id: field, label: t(field), value: field === 'planId' ? catalog.items.find((plan) => plan.id === values.planId)?.displayName ?? values.planId : values[field as keyof typeof values] }))
  return <Dialog open={open} modal={true} disablePointerDismissal={busy} onOpenChange={(nextOpen, event) => { if (!nextOpen && inFlight.current) event.cancel(); else setOpen(nextOpen) }}
    onOpenChangeComplete={(nextOpen) => { if (!nextOpen) close() }}>
    <DialogContent ref={panel} size="xl" presentation="fullscreen" showClose={false} closeLabel={t('closeWizard')} container={undefined}
      initialFocus={() => stepBody.current?.querySelector<HTMLElement>('input, button') ?? panel.current} finalFocus={() => trigger.current} className="min-w-0 wrap-anywhere">
      <DialogHeader><DialogTitle>{t('create')}</DialogTitle><DialogDescription>{t('wizardDescription')}</DialogDescription></DialogHeader>
      <DialogBody className="min-w-0 space-y-5">
        {!allowed ? <NoAccessEmpty resource={t('create')} owner="" showRequestAccess={false} onRequestAccess={undefined} defaultRequested={false} action={undefined} titleAs="h2" bordered={false}
          labels={{ title: () => t('blocked'), description: () => t('blockedDescription'), request: '', requested: '', sent: '' }} /> : <>
          <Stepper steps={steps.map((label) => ({ id: label, label: t(label) }))} current={step} orientation="horizontal" compact={true} onStepClick={undefined}
            label={t('steps')} statusText={{ complete: t('stepComplete'), current: t('stepCurrent'), upcoming: t('stepUpcoming'), error: t('stepError') }} formatCount={(current, total) => t('stepCount', { current, total })} />
          <div ref={stepBody} className="min-w-0 space-y-4">
            {step === 0 && <Field invalid={invalid}><FieldLabel htmlFor="tenant-name">{t('name')}</FieldLabel>
              <Input id="tenant-name" value={values.name} onValueChange={(value) => edit('name', value)} aria-invalid={invalid} aria-describedby={invalid ? 'tenant-name-error' : undefined} />
              {invalid && <FieldError id="tenant-name-error" match={true}>{t('requiredName')}</FieldError>}</Field>}
            {step === 1 && <>
              <Field invalid={invalid} disabled={catalogBlocked}><FieldLabel htmlFor="tenant-plan">{t('planId')}</FieldLabel>
                <SimpleSelect id="tenant-plan" value={values.planId} defaultValue="" placeholder={t(catalog.loading ? 'plansLoadingPlaceholder' : catalog.failure ? 'plansUnavailable' : !catalog.items.length ? 'plansEmptyPlaceholder' : 'planPlaceholder')}
                  aria-label={t('planId')} items={catalog.items.map((plan) => ({ value: plan.id, label: `${plan.displayName} (${plan.slug})` }))} clearable={false} size="md" disabled={catalogBlocked}
                  onValueChange={(value) => edit('planId', value ?? '')} aria-invalid={invalid} aria-describedby={`tenant-catalog-state${invalid ? ' tenant-plan-error' : ''}`}  className="w-full min-w-0" />
                {invalid && <FieldError id="tenant-plan-error" match={true}>{t('requiredPlan')}</FieldError>}
              </Field>
              <div id="tenant-catalog-state">
                {catalog.loading ? <Text role="status" aria-live="polite">{t('plansLoading')}</Text> : catalog.failure ? <Feedback area="catalog" failure={catalog.failure} retry={() => setCatalogAttempt((count) => count + 1)} close={dismiss} />
                  : !catalog.items.length ? <Text role="status">{t('plansEmpty')}</Text> : null}
              </div>
              {precheck && <Feedback area="precheck" failure={precheck} retry={retryPrecheck} close={null} polite={true} />}
            </>}
            {step === 2 && <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <Field invalid={invalid}><FieldLabel htmlFor="tenant-region">{t('region')}</FieldLabel>
                <SimpleSelect id="tenant-region" value={values.region} defaultValue="" placeholder={t('regionPlaceholder')} aria-label={t('region')} clearable={false} size="md" className="w-full min-w-0"
                  items={[{ value: 'eu-west', label: t('euWest') }, { value: 'us-east', label: t('usEast') }]} onValueChange={(value) => edit('region', value ?? '')} aria-invalid={invalid} aria-describedby={invalid ? 'tenant-region-error' : undefined} />
                {invalid && <FieldError id="tenant-region-error" match={true}>{t('requiredRegion')}</FieldError>}</Field>
              <Field invalid={false}><FieldLabel htmlFor="tenant-locale">{t('locale')}</FieldLabel><SimpleSelect id="tenant-locale" value={values.locale} defaultValue="es" placeholder={t('locale')} aria-label={t('locale')} clearable={false} size="md"
                items={[{ value: 'es', label: t('spanish') }, { value: 'en', label: t('english') }]} onValueChange={(value) => edit('locale', value ?? 'es')} /></Field>
            </div>}
            {step === 3 && <>
              <DescriptionListCard title={t('summary')} description="" items={summary} columns={1} wrap={true} titleAs="h2" onEdit={undefined} onCopy={undefined} editLabel=""
                labels={{ title: t('summary'), description: '', edit: '', copy: () => '', copied: () => '', copiedToClipboard: '' }} />
              {created ? <><Text role="status">{t('success')}</Text><Link href={superadmin ? `/console/tenants/${created}/plan` : '/console/tenants'} underline="always" external={false} externalLabel="">{t('openCreated')}</Link></>
                : failure && !busy ? <Feedback area="submit" failure={failure} retry={null} close={failure.status === 403 || failure.status === 404 ? dismiss : null} /> : null}
            </>}
          </div>
        </>}
      </DialogBody>
      <DialogFooter className="flex flex-wrap gap-3">
        <Button type="button" variant="secondary" disabled={busy} onClick={dismiss}>{t(allowed ? 'exit' : 'close')}</Button>
        {allowed && !created && <>
          {step > 0 && <Button type="button" variant="secondary" disabled={busy} onClick={back}>{t('back')}</Button>}
          {step < 3 ? <Button type="button" disabled={step === 1 && catalogBlocked} onClick={next}>{t('next')}</Button>
            : ![403, 404].includes(failure?.status ?? 0) && <Button type="button" loading={busy} disabled={busy} aria-busy={busy} onClick={() => void submit()}>{t(busy ? 'creating' : retrySubmit ? 'retry' : 'createTenant')}</Button>}
        </>}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
