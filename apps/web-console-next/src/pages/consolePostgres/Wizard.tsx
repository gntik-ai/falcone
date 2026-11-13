import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, Input, Link, SimpleSelect, Stepper, Text, Toaster, useAnnounce, useToast } from '@gntik-ai/ui'
import { ValidationSummary } from '@gntik-ai/blocks'
import { useConsoleContext } from '../../shell/context'
import { usePermissions } from '../../shell/permissions'
import { checkQuota, createDatabase, failureOf } from './api'
import { Action, Details, Empty, Notice } from './Parts'
import { focusRing, useCopy } from './copy'

export function LocalizedToaster() {
  const { t } = useCopy()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!container) return
    const translate = () => { const region = container.querySelector('[role="region"]'); if (region && region.getAttribute('aria-label') !== t('notifications')) region.setAttribute('aria-label', t('notifications')) }
    translate()
    const observer = new MutationObserver(translate)
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] })
    return () => observer.disconnect()
  }, [container, t])
  return <><div ref={setContainer} />{container && <Toaster closeLabel={t('closeToast')} container={container} className="" />}</>
}

export function Wizard({ close, trigger }: { close: () => void; trigger: HTMLElement | null }) {
  const { t } = useCopy(), context = useConsoleContext(), permission = usePermissions(), announce = useAnnounce(), toast = useToast()
  const [step, setStep] = useState(0), [engine, setEngine] = useState('postgresql'), [name, setName] = useState(''), [items, setItems] = useState<string[]>([])
  const [available, setAvailable] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<{ key: string; message?: string } | null>(null), [created, setCreated] = useState<string | null>(null)
  const flight = useRef(false), quota = useRef<Promise<boolean> | null>(null), mounted = useRef(false)
  const allowed = permission.can('workspace.write')
  useEffect(() => {
    mounted.current = true
    // The legacy hook runs even when permission blocks the wizard; pending/failed checks are available.
    quota.current ??= checkQuota(context.activeTenantId, context.activeWorkspaceId)
    void quota.current.then((value) => { if (mounted.current) setAvailable(value) }).catch(() => { if (mounted.current) setAvailable(true) })
    return () => { mounted.current = false }
  }, [context.activeTenantId, context.activeWorkspaceId])
  const steps = ['workspaceLabel', 'engine', 'configuration', 'review']
  const validation = step === 0 && !context.activeWorkspaceId ? 'workspaceValidation' : step === 1 && !name.trim() ? 'nameRequired' : step === 1 && !available ? 'quotaExhausted' : null
  const exit = () => { if (!flight.current) close() }
  async function submit() {
    if (flight.current || !allowed || !context.activeWorkspaceId || !name.trim() || !available) return
    flight.current = true; setBusy(true); setError(null)
    try {
      const response = await createDatabase(context.activeWorkspaceId, { engine, name, extensions: engine === 'postgresql' ? items : [], collections: engine === 'mongodb' ? items : [] })
      if (!mounted.current) return
      setCreated(response.databaseId)
      announce(t('created', { id: response.databaseId }), 'polite')
      toast.add({ title: t('created', { id: response.databaseId }), description: undefined, tone: 'success', priority: 'low' })
    } catch (cause) {
      if (mounted.current) {
        const status = failureOf(cause).status
        const message = (cause as { message?: string })?.message
        setError({ key: status === 401 ? 'sessionExpired' : status === 403 ? 'createForbidden' : message ? 'createServerError' : status === 409 ? 'createConflict' : status === 422 ? 'createInvalid' : 'createFailed', message })
      }
    } finally { flight.current = false; if (mounted.current) setBusy(false) }
  }
  if (!allowed) {
    const reason = permission.denyReason('workspace.write')
    const key = reason?.includes('Developer') ? 'denyDeveloper' : reason?.includes('Viewer') ? 'denyViewer' : permission.highestRoleTone === 'unknown' ? 'denyUnknown' : 'denyGeneric'
    return <section aria-label={t('blocked')} className="min-w-0 space-y-3"><Empty title={t('blocked')} /><Text as="p" variant="body" tone="muted">{t(key)}</Text><Action onClick={() => { close(); trigger?.focus() }}>{t('close')}</Action></section>
  }
  return <Dialog open={true} defaultOpen={false} modal={true} disablePointerDismissal={true} onOpenChange={(open) => { if (!open) exit() }}>
    <DialogContent size="md" presentation="responsive" container={undefined} keepMounted={false} showClose={false} closeLabel={t('close')} finalFocus={() => trigger ?? true} className="min-w-0 max-w-full wrap-anywhere">
      <DialogHeader><DialogTitle>{t('newDatabase')}</DialogTitle><DialogDescription>{t('wizardDescription')}</DialogDescription></DialogHeader>
      <Stepper steps={steps.map((key) => ({ id: key, label: t(key), description: null }))} current={step} orientation="vertical" compact={false} onStepClick={undefined} label={t('wizardSteps')} statusText={{ complete: t('stepComplete'), current: t('stepCurrent'), upcoming: t('stepUpcoming'), error: t('stepError') }} formatCount={(current, total) => t('stepCount', { current, total })} className="min-w-0" />
      <div className="min-w-0 space-y-4">
        {validation && <ValidationSummary errors={[{ fieldId: step === 1 ? 'pg-name' : 'pg-wizard-workspace', label: t(step === 1 ? 'name' : 'workspaceLabel'), message: t(validation) }]} submitCount={0} title={t('validationTitle')} labels={{ title: () => t('validationTitle') }} className="min-w-0" />}
        {step === 0 && <div id="pg-wizard-workspace" tabIndex={-1}><Text as="p" variant="body" tone="default">{t('workspaceLabel')}</Text><Text as="p" variant="body" tone="muted">{context.activeWorkspaceId ?? t('noWorkspaceActive')}</Text></div>}
        {step === 1 && <>
          <Field invalid={false} disabled={busy} className="min-w-0"><FieldLabel htmlFor="pg-engine">{t('engine')}</FieldLabel><SimpleSelect id="pg-engine" items={['postgresql', 'mongodb'].map((value) => ({ value, label: t(value) }))} value={engine} defaultValue="postgresql" placeholder={t('enginePlaceholder')} clearable={false} size="md" onValueChange={(value) => { setEngine(value ?? ''); setItems([]) }} className={`w-full min-w-0 ${focusRing}`} /></Field>
          <Field invalid={!name.trim()} disabled={busy} className="min-w-0"><FieldLabel htmlFor="pg-name">{t('name')}</FieldLabel><Input id="pg-name" type="text" size="md" name="name" value={name} onChange={(event) => setName(event.target.value)} invalid={!name.trim()} aria-describedby={validation ? 'pg-name-validation' : undefined} placeholder={undefined} autoComplete="off" readOnly={busy} leadingIcon={undefined} trailingIcon={undefined} leadingAddon={undefined} trailingAddon={undefined} className={`w-full min-w-0 ${focusRing}`} />{validation && <Text id="pg-name-validation" as="p" variant="supporting" tone="destructive">{t(validation)}</Text>}</Field>
        </>}
        {step === 2 && <div className="space-y-3"><Text as="p" variant="body" tone="default">{t(engine === 'postgresql' ? 'extensions' : 'collections')}</Text>{(engine === 'postgresql' ? ['uuid-ossp', 'pgcrypto'] : ['users', 'orders']).map((item) => <Checkbox key={item} name="initialItems" value={item} label={t(`items.${item}`)} description={null} checked={items.includes(item)} disabled={busy} onCheckedChange={(checked) => setItems((current) => checked ? [...current, item] : current.filter((value) => value !== item))} className={focusRing} />)}</div>}
        {step === 3 && <Details title={t('review')} items={[{ id: 'workspace', label: t('workspaceLabel'), value: context.activeWorkspaceId ?? t('notConfigured') }, { id: 'engine', label: t('engine'), value: t(engine) }, { id: 'name', label: t('name'), value: name }, { id: 'items', label: t('initialConfiguration'), value: items.join(', ') || t('notConfigured') }]} />}
        {error && <div role="alert"><Notice tone="warning" title={t(error.key, { message: error.message })} description="" /></div>}
        {created && <div role="status" className="space-y-2"><Text variant="body" tone="default">{t('created', { id: created })}</Text><Link href={engine === 'mongodb' ? '/console/mongo' : '/console/postgres'} tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t('openResource')}</Link></div>}
      </div>
      <DialogFooter><Action disabled={busy} onClick={() => step === 0 ? exit() : setStep((current) => current - 1)}>{t(step === 0 ? 'cancel' : 'previous')}</Action><Action variant="primary" loading={busy} disabled={Boolean(validation)} onClick={() => step < 3 ? setStep((current) => current + 1) : void submit()}>{t(busy ? 'confirming' : step < 3 ? 'next' : 'confirm')}</Action></DialogFooter>
    </DialogContent>
  </Dialog>
}
