import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Card, Field, FieldLabel, LiveAnnouncer, SimpleSelect, Text, WizardLayout, useAnnounce, type StepItem } from '@gntik-ai/ui'
import { readConsoleShellSession } from '@in-falcone/console-api/session'
import { getConsolePermissions } from '@in-falcone/console-api/permissions'
import { invite, membersQuota, failureOf, type InviteData, type Proof } from './api'
import { useCopy, focusRing, reasonKey } from './copy'
import { Action, Control, Empty, Notice, ProofView, failureKey } from './ui'

interface InviteProps { tenantId: string; workspaceId: string; onClose: () => void }
export function InviteWizard(props: InviteProps) {
  const [container] = useState(() => document.createElement('div'))
  const [mounted, setMounted] = useState(false)
  useLayoutEffect(() => {
    document.body.appendChild(container)
    const siblings = [...document.body.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element !== container)
    const previous = siblings.map((element) => element.inert)
    siblings.forEach((element) => { element.inert = true })
    setMounted(true)
    return () => {
      siblings.forEach((element, index) => { element.inert = previous[index] })
      container.remove()
    }
  }, [container])
  return mounted ? createPortal(<LiveAnnouncer><InviteFlow {...props} /></LiveAnnouncer>, container) : null
}
function InviteFlow({ tenantId, workspaceId, onClose }: InviteProps) {
  const { t } = useCopy(), announce = useAnnounce()
  // Re-read persisted permissions at open, independently of the shell's toolbar snapshot.
  const [roles] = useState(() => readConsoleShellSession()?.principal?.platformRoles ?? [])
  const allowed = getConsolePermissions(roles).can('tenant.members.manage')
  const heading = useRef<HTMLHeadingElement>(null), finish = useRef<HTMLButtonElement>(null), body = useRef<HTMLDivElement>(null)
  const active = useRef(true), lock = useRef(false), focusFrame = useRef<number | null>(null)
  const [current, setCurrent] = useState(0), [data, setData] = useState<InviteData>({ workspaceId, email: '', role: '' })
  const [invalid, setInvalid] = useState<number[]>([]), [validation, setValidation] = useState(''), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [proof, setProof] = useState<Proof | null>(null)
  const [quota, setQuota] = useState<'pending' | 'available' | 'exhausted'>('pending')
  const labels = [t('workspace'), t('email'), t('role'), t('summary')]
  useLayoutEffect(() => {
    active.current = true; heading.current?.focus()
    return () => { active.current = false; if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current) }
  }, [])
  useEffect(() => {
    if (!allowed) return
    const controller = new AbortController()
    let live = true
    void Promise.resolve().then(async () => {
      if (!live) return
      try { const available = await membersQuota(tenantId, workspaceId, controller.signal); if (live) setQuota(available ? 'available' : 'exhausted') }
      catch { if (live) setQuota('available') }
    })
    return () => { live = false; controller.abort() }
  }, [allowed, tenantId, workspaceId])
  useLayoutEffect(() => { if (error) finish.current?.focus() }, [error])
  function move(next: number) {
    if (busy || proof) return
    let message = ''
    if (next > current) {
      if (current === 0 && !data.workspaceId) message = t('workspaceRequired')
      if (current === 1) message = quota === 'pending' ? t('quotaPending') : quota === 'exhausted' ? t('quotaExhausted') : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) ? t('emailInvalid') : ''
      if (current === 2 && !['workspace_viewer', 'workspace_developer', 'workspace_admin'].includes(data.role)) message = t('roleRequired')
    }
    setValidation(message)
    if (message) { setInvalid((steps) => [...new Set([...steps, current])]); announce(message, 'assertive'); return }
    setInvalid((steps) => steps.filter((step) => step !== current)); setCurrent(next); setError('')
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current)
    focusFrame.current = requestAnimationFrame(() => body.current?.querySelector<HTMLElement>('input,button,[tabindex]')?.focus())
  }
  async function submit() {
    if (lock.current || proof || current !== 3 || !allowed || quota !== 'available') return
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current)
    lock.current = true; setBusy(true); setError('')
    try {
      const response = await invite(tenantId, data)
      if (active.current) { setProof(response); announce(t('invitationReady')) }
    } catch (cause) {
      if (active.current) setError(t(failureKey(failureOf(cause), 'inviteFailure')))
    } finally { lock.current = false; if (active.current) setBusy(false) }
  }
  const steps: StepItem[] = labels.map((label, index) => ({ id: String(index), label, description: null, status: invalid.includes(index) ? 'error' : index < current ? 'complete' : index === current ? 'current' : 'upcoming' }))
  return <WizardLayout mode="page" size="fullscreen" open={true} onOpenChange={undefined} description={t('inviteHelp')} returnFocusRef={undefined} closeOnInteractOutside={false} cancelLabel={t('cancel')} stepsSummaryLabel={t('steps')} stepAnnouncement={({ position, total, label }) => t('stepCount', { step: position, total, label })}
    steps={steps} stepsInteractive={false} stepStatusText={{ complete: t('stepComplete'), current: t('stepCurrent'), upcoming: t('stepUpcoming'), error: t('stepError') }} formatStepCount={(step, total) => t('stepCount', { step, total, label: labels[step - 1] })}
    current={current} onStepChange={move} onFinish={() => void submit()} onExit={onClose} title={<h1 ref={heading} tabIndex={-1} className={focusRing}>{t('invite')}</h1>} logo={null}
    footerStart={null} footer={<footer className="flex flex-wrap justify-end gap-3 border-t border-border p-4">{allowed && !proof && <><Action disabled={busy || current === 0} onClick={() => move(current - 1)}>{t('back')}</Action>{current < 3 ? <Action variant="primary" onClick={() => move(current + 1)}>{t('next')}</Action> : <Action ref={finish} variant="primary" loading={busy} disabled={busy} focusableWhenDisabled={true} onClick={() => void submit()}>{t(busy ? 'confirming' : 'finish')}</Action>}</>}</footer>}
    backLabel={t('back')} backDisabled={busy} nextLabel={t('next')} finishLabel={t('finish')} nextDisabled={busy} nextLoading={busy} finishPending={busy} pendingLabel={t('confirming')} exitLabel={t('exit')}
    confirmExit={false} exitTitle={t('exit')} exitDescription={t('inviteHelp')} exitConfirmLabel={t('exit')} exitCancelLabel={t('cancel')} stepsLabel={t('steps')} width="default" mainId="members-invite-main" skipLinkLabel={t('skipStep')} fullScreen={true} className="fixed inset-0 z-50 min-w-0 wrap-anywhere" data-testid="members-invite">
    {!allowed ? <Empty title={t('blocked')} description={t(reasonKey(roles))} /> : proof ? <ProofView tenantId={tenantId} proof={proof} onClose={onClose} closeLabel={t('close')} /> : <div ref={body} className="min-w-0 space-y-4">
      {current === 0 && <Field invalid={Boolean(validation)}><FieldLabel required={false}>{t('workspace')}</FieldLabel><Control value={data.workspaceId || t('noWorkspace')} readOnly /></Field>}
      {current === 1 && <><Field invalid={Boolean(validation)}><FieldLabel required>{t('email')}</FieldLabel><Control value={data.email} onValueChange={(email) => setData({ ...data, email })} aria-describedby={validation ? 'invite-validation' : undefined} /></Field>{quota === 'pending' && <Text as="p" variant="body" tone="muted">{t('quotaPending')}</Text>}</>}
      {current === 2 && <SimpleSelect value={data.role} onValueChange={(role) => setData({ ...data, role: role ?? '' })} items={['workspace_viewer', 'workspace_developer', 'workspace_admin'].map((value) => ({ value, label: t(`workspaceRoles.${value}`) }))} label={t('role')} placeholder={t('selectRole')} size="md" disabled={false} clearable={false} clearLabel={t('clear')} onClear={undefined} loadOptions={undefined} loadingText={t('loading')} errorText={t('optionsFailure')} emptyText={t('empty')} className={focusRing} />}
      {validation && <div id="invite-validation"><Notice message={validation} /></div>}
      {current === 3 && <><h2 className="text-lg font-semibold">{t('summary')}</h2>{[data.workspaceId, data.email, data.role].map((value, index) => <Card key={index} className="min-w-0 space-y-2 p-4"><h3 className="font-medium">{labels[index]}</h3><Text as="p" variant="body" tone="default">{value}</Text><Action disabled={busy} aria-label={t('editNamed', { name: labels[index] })} onClick={() => move(index)}>{t('edit')}</Action></Card>)}</>}
      {error && <Notice message={error} />}
    </div>}
  </WizardLayout>
}
