import { useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Checkbox, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, FieldLabel, Link, SimpleSelect, Stepper, Text, useToast } from '@gntik-ai/ui'
import { ValidationSummary } from '@gntik-ai/blocks'
import { requestConsoleSessionJson } from '@in-falcone/console-api/session'
import { createRequestId } from '@in-falcone/console-api/http'
import { useConsoleContext } from '../../shell/context'
import { usePermissions } from '../../shell/permissions'
import { Action, Details, Empty, TextField } from './States'
import { useCopy, focusRing } from './copy'
export function Wizard({ close, opener }: { close: () => void; opener: HTMLElement | null }) {
  const { t } = useCopy(), { activeTenantId, activeWorkspaceId } = useConsoleContext(), { can, denyReason } = usePermissions(), toast = useToast()
  const [step, setStep] = useState(0), [engine, setEngine] = useState('postgresql'), [name, setName] = useState(''), [items, setItems] = useState<string[]>([])
  const [quota, setQuota] = useState(true), [busy, setBusy] = useState(false), [result, setResult] = useState<{ databaseId: string } | null>(null), [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const live = useRef(true), sending = useRef(false)
  const allowed = can('workspace.write')
  const denial = denyReason('workspace.write')
  const denialKey = denial?.includes('Developer') ? 'developer' : denial?.includes('Viewer') ? 'viewer' : denial?.includes('Tu rol actual') ? 'generic' : 'unknown'
  useEffect(() => {
    live.current = true
    async function check() {
      if (!activeTenantId) return
      try {
        await Promise.all([requestConsoleSessionJson(`/v1/metrics/tenants/${activeTenantId}/quotas`), requestConsoleSessionJson(`/v1/metrics/tenants/${activeTenantId}/overview`)])
        if (!activeWorkspaceId) return
        const [posture, overview] = await Promise.all([
          requestConsoleSessionJson<{ dimensions?: { dimensionId: string; hardLimit?: number | null; measuredValue?: number }[]; hardLimitBreaches?: string[] }>(`/v1/metrics/workspaces/${activeWorkspaceId}/quotas`),
          requestConsoleSessionJson<{ hardLimitDimensions?: string[] }>(`/v1/metrics/workspaces/${activeWorkspaceId}/overview`),
        ])
        const dimension = posture.dimensions?.find((item) => item.dimensionId === 'databases.count')
        const exceeded = dimension && ((dimension.hardLimit != null && dimension.hardLimit > 0 && Math.round(((dimension.measuredValue ?? 0) / dimension.hardLimit) * 100) >= 100) || [...(posture.hardLimitBreaches ?? []), ...(overview.hardLimitDimensions ?? [])].includes('databases.count'))
        if (live.current) setQuota(activeTenantId === 'platform' || !exceeded)
      } catch { /* Legacy treats an unavailable quota check as available. */ }
    }
    void check()
    return () => { live.current = false }
  }, [activeTenantId, activeWorkspaceId])
  const validation = step === 0 && !activeWorkspaceId ? t('workspaceMissing') : step === 1 && !name.trim() ? t('nameRequired') : step === 1 && !quota ? t('quotaExhausted') : null
  async function submit() {
    if (sending.current || !allowed || !activeWorkspaceId || !name.trim() || !quota) return
    sending.current = true; setBusy(true); setError(null); setResult(null)
    try {
      const response = await requestConsoleSessionJson<{ databaseId: string }>(`/v1/workspaces/${activeWorkspaceId}/databases`, {
        method: 'POST', body: { engine, name, extensions: engine === 'postgresql' ? items : [], collections: engine === 'mongodb' ? items : [] },
        idempotent: true, headers: { 'X-Request-Id': createRequestId('wiz') },
      })
      if (live.current) { setResult(response); toast.add({ title: t('created'), description: undefined, tone: 'success', priority: 'low' }) }
    } catch (cause) {
      const failure = cause as { status?: number; message?: string }
      if (live.current) setError(failure.status === 401 ? t('submit401') : failure.status === 403 ? t('submit403') : failure.status === 409 || failure.status === 422 ? failure.message || t(`submit${failure.status}`) : failure.message || t('serverError'))
    } finally { sending.current = false; if (live.current) setBusy(false) }
  }
  const summary = [{ id: 'workspace', label: t('workspace'), value: activeWorkspaceId ?? '' }, { id: 'engine', label: t('engine'), value: engine }, { id: 'name', label: t('name'), value: name }, { id: 'config', label: t('initialConfig'), value: items.join(', ') || t('notConfigured') }]
  return <Dialog open={open} modal={true} disablePointerDismissal={true} onOpenChange={(next, event) => { if (busy) event.cancel(); else setOpen(next) }} onOpenChangeComplete={(next) => { if (!next) close() }}>
    <DialogContent size="md" presentation="responsive" showClose={true} closeLabel={t('close')} container={undefined} keepMounted={false} initialFocus={true} finalFocus={() => opener?.isConnected ? opener : document.getElementById('pg-heading')} className="min-w-0 max-w-full wrap-anywhere" data-testid="pg-wizard">
      <DialogHeader><DialogTitle>{t('newDatabase')}</DialogTitle><DialogDescription>{t('wizardDescription')}</DialogDescription></DialogHeader>
      <DialogBody className="min-w-0 space-y-4">
        {!allowed ? <Empty title={t('blocked')} description={t(`permissionReasons.${denialKey}`)} /> : <>
          <Stepper steps={['workspace', 'engine', 'config', 'review'].map((id) => ({ id, label: t(id), description: undefined, status: undefined }))} current={step} orientation="vertical" compact={false} onStepClick={undefined} label={t('newDatabase')} statusText={{ complete: t('complete'), current: t('current'), upcoming: t('upcoming'), error: t('invalid') }} formatCount={(current, total) => t('stepCount', { step: current, total })} className="min-w-0" />
          {validation && <ValidationSummary title={t('validation')} errors={[{ fieldId: step === 0 ? 'pg-wizard-workspace' : 'pg-wizard-name', message: validation }]} submitCount={0} labels={{ title: () => t('validation') }} className="min-w-0" />}
          {step === 0 && <div id="pg-wizard-workspace"><Text as="p" variant="label" tone="default">{t('workspace')}</Text><Text as="p" variant="body" tone="default">{activeWorkspaceId || t('noneWorkspace')}</Text></div>}
          {step === 1 && <>
            <Field invalid={false} disabled={busy} className="min-w-0"><FieldLabel htmlFor="pg-engine">{t('engine')}</FieldLabel><SimpleSelect id="pg-engine" value={engine} defaultValue="postgresql" placeholder={t('selectEngine')} clearable={false} size="md" items={['postgresql', 'mongodb'].map((value) => ({ value, label: t(value) }))} onValueChange={(value) => { setEngine(value ?? ''); setItems([]) }} className={`w-full min-w-0 ${focusRing}`} /></Field>
            <TextField id="pg-wizard-name" label={t('name')} placeholder={t('namePlaceholder')} value={name} onChange={setName} busy={busy} />
          </>}
          {step === 2 && <><Text as="p" variant="label" tone="default">{t(engine === 'postgresql' ? 'extensions' : 'collections')}</Text>{(engine === 'postgresql' ? ['uuid-ossp', 'pgcrypto'] : ['users', 'orders']).map((item) => <Checkbox key={item} label={item} description={undefined} checked={items.includes(item)} defaultChecked={false} disabled={false} indeterminate={false} onCheckedChange={(checked) => setItems(checked ? [...items, item] : items.filter((value) => value !== item))} className={focusRing} />)}</>}
          {step === 3 && <Details title={t('review')} items={summary} />}
          {error && <ValidationSummary title={t('validation')} errors={[{ fieldId: 'pg-wizard-confirm', message: error }]} submitCount={1} labels={{ title: () => t('validation') }} className="min-w-0" />}
          {result && <div role="status" className="min-w-0 space-y-2"><Text as="p" variant="body" tone="default">{t('labelValue', { label: t('created'), value: result.databaseId })}</Text><Link render={<RouterLink to={engine === 'mongodb' ? '/console/mongo' : '/console/postgres'} onClick={() => setOpen(false)} />} tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t('openResource')}</Link></div>}
        </>}
      </DialogBody>
      <DialogFooter className="flex-wrap gap-2">
        <Action disabled={busy} onClick={() => { if (step === 0 || !allowed) setOpen(false); else setStep(step - 1) }}>{t(step === 0 || !allowed ? 'cancel' : 'previous')}</Action>
        {allowed && (step < 3 ? <Action variant="primary" disabled={Boolean(validation)} onClick={() => setStep(step + 1)}>{t('next')}</Action> : <Action id="pg-wizard-confirm" variant="primary" busy={busy} disabled={!quota || !allowed || !activeWorkspaceId || !name.trim()} onClick={() => void submit()}>{t(busy ? 'confirming' : 'confirm')}</Action>)}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
