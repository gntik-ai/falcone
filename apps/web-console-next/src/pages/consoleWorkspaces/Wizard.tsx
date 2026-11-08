import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Field, FieldLabel, LiveAnnouncer, Text, Textarea, Toaster, WizardLayout, useAnnounce, useToast, type StepItem } from '@gntik-ai/ui'
import { DescriptionListCard, FormSection, TableSkeleton } from '@gntik-ai/blocks'
import { readConsoleShellSession } from '@in-falcone/console-api/session'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import { createWorkspace, failureOf, integerError, type Failure, type WorkspaceData } from './api'
import { focusRing, reasonKey, useCopy } from './copy'
import { Action, Control, Empty, FailureView, createMessageKey, createTitleKey, quotaTitleKey } from './ui'
import type { QuotaState } from './useQuota'

interface Props { tenantId: string | null; quota: QuotaState & { reload: () => Promise<boolean> }; onClose: () => void; returnFocusRef: RefObject<HTMLButtonElement | null> }
export function Wizard({ tenantId, quota, onClose, returnFocusRef }: Props) {
  const { t } = useCopy(), toast = useToast()
  const [roles] = useState(() => readConsoleShellSession()?.principal?.platformRoles ?? [])
  const allowed = getConsolePermissions(roles).can('tenant.workspaces.create')
  const [current, setCurrent] = useState(0)
  const [data, setData] = useState<WorkspaceData>({ name: '', description: '', maxFunctions: '10', maxDatabases: '5' })
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<Failure | null>(null), [createdId, setCreatedId] = useState<string | null>(null)
  const name = useRef<HTMLInputElement>(null), finish = useRef<HTMLButtonElement>(null), retry = useRef<HTMLButtonElement>(null)
  const live = useRef(true), lock = useRef(false)
  const titleFrame = useRef<number | null>(null)
  useEffect(() => { live.current = true; return () => { live.current = false; if (titleFrame.current !== null) cancelAnimationFrame(titleFrame.current) } }, [])
  const setHeading = useCallback((node: HTMLElement | null) => {
    const heading = node?.closest('h2')
    if (heading) { heading.tabIndex = -1; titleFrame.current = requestAnimationFrame(() => heading.focus()) }
  }, [])
  const focusResult = useCallback((node: HTMLElement | null) => {
    const heading = node?.closest('h2')
    if (heading) { heading.tabIndex = -1; titleFrame.current = requestAnimationFrame(() => heading.focus()) }
  }, [])
  const labels = [t('tenant'), t('name'), t('configuration'), t('summary')]
  const nameError = !data.name.trim() ? t('nameRequired') : ''
  const quotaError = !quota.available ? t('quotaExhausted') : ''
  const limits = ['maxFunctions', 'maxDatabases'] as const
  const limitError = (key: typeof limits[number]) => { const error = integerError(data[key]); return error ? t(error, { label: t(key), min: 1, max: String(Number.MAX_SAFE_INTEGER) }) : '' }
  const invalid = current === 0 ? !tenantId : current === 1 ? Boolean(nameError || quotaError || quota.pending) : current === 2 ? limits.some((key) => Boolean(limitError(key))) : false
  const result = Boolean(failure || createdId !== null)
  useEffect(() => {
    if (titleFrame.current !== null) cancelAnimationFrame(titleFrame.current)
    if (current !== 1) return
    const frame = requestAnimationFrame(() => name.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [current])
  function move(next: number) {
    if (busy || result || next > current && invalid) return
    setCurrent(Math.max(0, Math.min(3, next)))
  }
  async function retryQuota() {
    const restored = await quota.reload()
    if (!live.current) return
    requestAnimationFrame(() => restored ? name.current?.focus() : retry.current?.focus())
  }
  async function submit() {
    if (lock.current || !allowed || !tenantId || current !== 3 || createdId !== null || nameError || quotaError || quota.pending || limits.some((key) => integerError(data[key]))) return
    lock.current = true; setBusy(true)
    try {
      const response = await createWorkspace(tenantId, data)
      if (!live.current) return
      setFailure(null); setCreatedId(response.workspaceId)
      toast.add({ title: t('successTitle'), description: t('successAnnouncement', { id: response.workspaceId }), tone: 'success', priority: 'low' })
    } catch (cause) {
      if (!live.current) return
      const error = failureOf(cause)
      setFailure(error)
    } finally { lock.current = false; if (live.current) setBusy(false) }
  }
  function backToSummary() {
    setFailure(null)
    requestAnimationFrame(() => finish.current?.focus())
  }
  const steps: StepItem[] = labels.map((label, index) => ({ id: String(index), label, description: null, status: index < current ? 'complete' : index === current ? 'current' : 'upcoming' }))
  return <WizardLayout mode="overlay" size="fullscreen" open={true} onOpenChange={(open) => { if (!open) onClose() }} description={t('wizardDescription')} returnFocusRef={returnFocusRef} closeOnInteractOutside={false} cancelLabel={t('cancel')} stepsSummaryLabel={t('steps')}
    stepAnnouncement={({ position, total }) => !allowed ? t('blocked') : createdId !== null ? t('successTitle') : failure ? `${t(createTitleKey(failure.status))} ${t(createMessageKey(failure.status))}` : t('stepCount', { step: position, total, label: labels[position - 1] })}
    steps={steps} stepsInteractive={false} stepStatusText={{ complete: t('stepComplete'), current: t('stepCurrent'), upcoming: t('stepUpcoming'), error: t('stepError') }} formatStepCount={(step, total) => t('stepCount', { step, total, label: labels[step - 1] })}
    current={current} onStepChange={move} onFinish={() => void submit()} onExit={undefined} title={<span ref={setHeading} className={focusRing}>{t('create')}</span>} logo={null} footerStart={null}
    footer={<footer className="flex flex-wrap justify-end gap-3 border-t border-border p-4">{allowed && !result && <><Action disabled={busy || current === 0} onClick={() => move(current - 1)}>{t('back')}</Action>{current < 3 ? <Action type="submit" form="workspace-step" variant="primary" disabled={invalid}>{t('next')}</Action> : <Action ref={finish} type="submit" form="workspace-step" variant="primary" loading={busy} disabled={busy}>{t(busy ? 'confirming' : 'finish')}</Action>}</>}{failure && <><Action onClick={backToSummary} disabled={busy}>{t('backSummary')}</Action>{![403, 404, 409, 422].includes(failure.status ?? 0) && <Action variant="primary" loading={busy} disabled={busy} onClick={() => void submit()}>{t('retry')}</Action>}</>}</footer>}
    backLabel={t('back')} backDisabled={busy} nextLabel={t('next')} finishLabel={t('finish')} nextDisabled={invalid || busy} nextLoading={false} finishPending={busy} pendingLabel={t('confirming')} exitLabel={t('exit')}
    confirmExit={false} exitTitle={t('exit')} exitDescription={t('wizardDescription')} exitConfirmLabel={t('exit')} exitCancelLabel={t('cancel')} stepsLabel={t('steps')} width="default" mainId="workspace-wizard-main" skipLinkLabel={t('skipStep')} fullScreen={true} className="h-full min-w-0 wrap-anywhere" data-testid="workspace-wizard">
    {!allowed ? <Empty title={t('blocked')} description={t(reasonKey(roles))} /> : createdId !== null ? <div data-testid="workspace-create-success"><Empty title={<span ref={focusResult}>{t('successTitle')}</span>} description={t('successAnnouncement', { id: createdId })} /></div> : failure ? <FailureView failure={failure} quota={false} titleRef={focusResult} /> :
      <form id="workspace-step" className="min-w-0 space-y-4" onSubmit={(event) => { event.preventDefault(); if (current < 3) move(current + 1); else void submit() }}>
        {current < 3 ? <FormSection title={labels[current]} description={null} labels={{ title: labels[current], description: '' }} actions={null} headingLevel="h2" divided={false} className="min-w-0">
          {current === 0 && <><Text as="p" variant="body" tone="default">{t('tenantContext')}</Text><Text as="p" variant="body" tone="default">{tenantId ?? t('noTenant')}</Text>{!tenantId && <Text as="p" variant="body" tone="destructive">{t('tenantRequired')}</Text>}</>}
          {current === 1 && <div className="min-w-0 space-y-4">
            <Field invalid={Boolean(nameError || quotaError)}><FieldLabel htmlFor="workspace-name" required={true}>{t('nameLabel')}</FieldLabel><Control id="workspace-name" ref={name} value={data.name} onValueChange={(value) => setData({ ...data, name: value })} invalid={Boolean(nameError || quotaError)} aria-invalid={Boolean(nameError || quotaError)} aria-describedby={nameError || quotaError ? 'workspace-name-error' : undefined} />{(nameError || quotaError) && <Text id="workspace-name-error" as="p" variant="body" tone="destructive">{nameError || quotaError}</Text>}</Field>
            {quota.pending && !quota.failure && <TableSkeleton columns={1} rows={1} label={t('quotaLoading')} className="min-w-0" />}
            {quota.failure && <><FailureView failure={quota.failure} quota={true} /><Action ref={retry} disabled={quota.pending} focusableWhenDisabled={true} onClick={() => void retryQuota()}>{t('retry')}</Action></>}
          </div>}
          {current === 2 && <div className="min-w-0 space-y-4">
            <Field invalid={false}><FieldLabel htmlFor="workspace-description" required={false}>{t('description')}</FieldLabel><Textarea id="workspace-description" value={data.description} onChange={(event) => setData({ ...data, description: event.target.value })} size="md" disabled={false} invalid={false} placeholder={undefined} autosize={false} className={`min-w-0 ${focusRing}`} /></Field>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">{limits.map((key) => <Field key={key} invalid={Boolean(limitError(key))}><FieldLabel htmlFor={`workspace-${key}`} required={true}>{t(key)}</FieldLabel>
              {/* A text-backed kit Input preserves legacy integer syntax errors, unlike NumberInput's numeric coercion. */}
              <Control id={`workspace-${key}`} inputMode="numeric" value={data[key]} onValueChange={(value) => setData({ ...data, [key]: value })} invalid={Boolean(limitError(key))} aria-invalid={Boolean(limitError(key))} aria-describedby={limitError(key) ? `workspace-${key}-error` : undefined} />
              {limitError(key) && <Text id={`workspace-${key}-error`} as="p" variant="body" tone="destructive">{limitError(key)}</Text>}
            </Field>)}</div>
          </div>}
        </FormSection> : <DescriptionListCard title={t('summary')} description="" items={[{ id: 'tenant', label: t('tenant'), value: tenantId ?? '', copyable: false }, { id: 'name', label: t('name'), value: data.name, copyable: false }, { id: 'description', label: t('description'), value: data.description || t('notConfigured'), copyable: false }, ...limits.map((key) => ({ id: key, label: t(key), value: data[key], copyable: false }))]} wrap={true} columns={1} onEdit={undefined} editLabel={t('back')} onCopy={undefined} titleAs="h2" className="min-w-0" labels={{ title: t('summary'), description: '', edit: t('back'), copy: (label) => t('copyNamed', { label }), copied: () => t('copied'), copiedToClipboard: t('copied') }} />}
      </form>}
    <LiveAnnouncer><Announcements failure={failure} createdId={createdId} current={current} quota={quota} /></LiveAnnouncer>
    <LocalizedToaster />
  </WizardLayout>
}

function Announcements({ failure, createdId, current, quota }: { failure: Failure | null; createdId: string | null; current: number; quota: QuotaState }) {
  const { t } = useCopy(), announce = useAnnounce()
  useEffect(() => {
    if (failure) announce(`${t(createTitleKey(failure.status))} ${t(createMessageKey(failure.status))}`, 'assertive')
  }, [failure, t, announce])
  useEffect(() => {
    if (createdId !== null) announce(t('successAnnouncement', { id: createdId }), 'polite')
  }, [createdId, t, announce])
  useEffect(() => {
    if (current === 1 && quota.failure && !quota.pending) announce(`${t(quotaTitleKey(quota.failure.status))} ${t('quotaFailureDescription')}`, 'polite')
  }, [current, quota.failure, quota.pending, t, announce])
  return null
}

// The pinned Toaster does not expose its primitive's region label.
function LocalizedToaster() {
  const { t } = useCopy()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!container) return
    const translate = () => {
      const region = container.querySelector('[role="region"]')
      if (region && region.getAttribute('aria-label') !== t('notifications')) region.setAttribute('aria-label', t('notifications'))
    }
    translate()
    const observer = new MutationObserver(translate)
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] })
    return () => observer.disconnect()
  }, [container, t])
  return <><div ref={setContainer} />{container && <Toaster closeLabel={t('close')} container={container} className="min-w-0 max-w-full" />}</>
}
