import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, EmptyState, Field, FieldLabel, Input, Text, useAnnounce, useToast } from '@gntik-ai/ui'
import { InlineCallout, SectionHeader, TableSkeleton } from '@gntik-ai/blocks'
import { usePermissions } from '../../shell/permissions'
import {
  accountName, alreadyApplied, createServiceAccount, deleteServiceAccount, failureOf, isNetwork, isRevoked, issueCredential, listServiceAccounts, revokeCredential, rotateCredential, accessToken,
  type Failure, type IssuedCredential, type ServiceAccount,
} from './api'
import { Disclosure, type DisclosureMode } from './Disclosure'
import { ConfirmDialog, type ConfirmAction } from './Confirm'
import { FailureView, focusRing } from './Failure'
import { AccountsTable, credentialHelpId, triggerSelector } from './Table'

type Outcome<T> = { ok: true; value: T; renewed: boolean } | { ok: false; failure: Failure } | null
interface ConfirmState {
  action: ConfirmAction; account: ServiceAccount; trigger: HTMLElement; open: boolean; pending: boolean; failure: Failure | null
  // A network failure leaves the outcome of a revoke or delete unknown: Reintentar reads the list first.
  precheck: boolean; returnTo: 'trigger' | 'heading' | 'none'
}
interface DisclosureState { mode: DisclosureMode; account: ServiceAccount; credential: IssuedCredential; open: boolean }

function useList(workspaceId: string) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ attempt: number; rows?: ServiceAccount[]; failure?: Failure }>({ attempt: -1 })
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    // Wait for effect replay to settle so StrictMode also starts just one request.
    void Promise.resolve().then(async () => {
      if (!active) return
      try { const rows = await listServiceAccounts(workspaceId, controller.signal); if (active) setState({ attempt, rows }) }
      catch (cause) { if (active) setState({ attempt, failure: failureOf(cause) }) }
    })
    return () => { active = false; controller.abort() }
  }, [workspaceId, attempt])
  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  const replace = useCallback((rows: ServiceAccount[]) => setState({ attempt, rows }), [attempt])
  return { attempt, loading: state.attempt !== attempt, rows: state.rows, failure: state.attempt === attempt ? state.failure : undefined, reload, replace }
}

export function Content({ workspaceId, tenantActive, heading, focusHeading, onChooseWorkspace }: {
  workspaceId: string; tenantActive: boolean; heading: RefObject<HTMLHeadingElement | null>; focusHeading: boolean; onChooseWorkspace: () => void
}) {
  const { t } = useTranslation('pages.console-service-accounts-page')
  const announce = useAnnounce(), toast = useToast()
  const permissions = usePermissions()
  const list = useList(workspaceId)
  const blocked = !tenantActive || !permissions.can('workspace.write')
  const blockedReason = !tenantActive ? t('notice.tenantInactive') : permissions.denyReason('workspace.write') ?? ''
  const id = useId()
  const alive = useRef(true)
  const inFlight = useRef(new Set<string>())
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [name, setName] = useState('')
  const [create, setCreate] = useState<{ pending: boolean; failure: Failure | null }>({ pending: false, failure: null })
  const [issue, setIssue] = useState<{ account: ServiceAccount; pending: boolean; failure: Failure | null } | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [disclosure, setDisclosure] = useState<DisclosureState | null>(null)
  const confirmRef = useRef(confirm)
  confirmRef.current = confirm
  // Focus is returned after the dialog unmounts, so keep the last open state for finalFocus.
  const lastConfirm = useRef(confirm)
  if (confirm) lastConfirm.current = confirm
  const nameInput = useRef<HTMLInputElement>(null)
  const createButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  // A context switch remounts this component: land on the heading, never on a vanished row.
  useEffect(() => { if (focusHeading) heading.current?.focus() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const begin = (key: string) => { if (inFlight.current.has(key)) return false; inFlight.current.add(key); setBusy(new Set(inFlight.current)); return true }
  const end = (key: string) => { inFlight.current.delete(key); if (alive.current) setBusy(new Set(inFlight.current)) }
  // Results of a request that outlives this context are discarded (null).
  async function attempt<T>(send: () => Promise<T>): Promise<Outcome<T>> {
    const before = accessToken()
    try { const value = await send(); return alive.current ? { ok: true, value, renewed: accessToken() !== before } : null }
    catch (cause) { return alive.current ? { ok: false, failure: failureOf(cause) } : null }
  }
  function notify(title: string, renewed: boolean) {
    toast.add({ title, description: renewed ? t('feedback.sessionRenewed') : undefined, tone: 'success', priority: 'low' })
    announce(renewed ? `${title} ${t('feedback.sessionRenewed')}` : title, 'polite')
  }
  const patchConfirm = (patch: Partial<ConfirmState>) => setConfirm((current) => current && { ...current, ...patch })
  const returnFocus = (kind: string, accountId: string) => () => {
    const trigger = document.querySelector<HTMLButtonElement>(triggerSelector(kind, accountId))
    return trigger && !trigger.disabled ? trigger : heading.current ?? true
  }

  async function submitCreate() {
    if (blocked || !name.trim() || !begin('create')) return
    setCreate((current) => ({ ...current, pending: true }))
    const result = await attempt(() => createServiceAccount(workspaceId, name))
    end('create')
    if (!result) return
    if (!result.ok) { setCreate({ pending: false, failure: result.failure }); return }
    setCreate({ pending: false, failure: null }); setName('')
    notify(t('create.created', { id: result.value.serviceAccountId }), result.renewed)
    list.reload(); nameInput.current?.focus()
  }
  const dismissCreate = () => { setCreate({ pending: false, failure: null }); createButton.current?.focus() }
  const backFromCreate = () => { setCreate({ pending: false, failure: null }); list.reload(); heading.current?.focus() }

  async function reveal(account: ServiceAccount) {
    const accountId = account.serviceAccountId
    if (blocked || isRevoked(account) || !begin(`reveal:${accountId}`)) return
    setIssue((current) => ({ account, pending: true, failure: current?.account.serviceAccountId === accountId ? current.failure : null }))
    const result = await attempt(() => issueCredential(workspaceId, accountId))
    end(`reveal:${accountId}`)
    if (!result) return
    if (!result.ok) { setIssue({ account, pending: false, failure: result.failure }); return }
    setIssue(null)
    setDisclosure({ mode: 'reveal', account, credential: result.value, open: true })
    notify(t('feedback.revealed', { name: accountName(account) }), result.renewed)
    list.reload()
  }
  const dismissIssue = () => {
    const accountId = issue?.account.serviceAccountId
    setIssue(null)
    if (accountId) document.querySelector<HTMLElement>(triggerSelector('reveal', accountId))?.focus()
  }
  const backFromIssue = () => { setIssue(null); list.reload(); heading.current?.focus() }

  async function submitConfirm(retry: boolean) {
    const current = confirmRef.current
    if (!current || blocked) return
    const { action, account } = current
    const accountId = account.serviceAccountId, label = accountName(account), key = `${action}:${accountId}`
    if (!begin(key)) return
    patchConfirm({ pending: true })
    try {
      if (retry && current.precheck && action !== 'rotate') {
        const check = await attempt(() => listServiceAccounts(workspaceId))
        if (!check) return
        if (!check.ok) { patchConfirm({ pending: false, failure: check.failure }); return }
        list.replace(check.value)
        if (alreadyApplied(action, check.value, accountId)) {
          patchConfirm({ open: false, pending: false, returnTo: 'heading' })
          notify(t(action === 'revoke' ? 'feedback.alreadyRevoked' : 'feedback.alreadyDeleted', { name: label }), false)
          return
        }
        patchConfirm({ precheck: false })
      }
      const result = await attempt<IssuedCredential | void>(() => action === 'rotate' ? rotateCredential(workspaceId, accountId) : action === 'revoke' ? revokeCredential(workspaceId, accountId) : deleteServiceAccount(workspaceId, accountId))
      if (!result) return
      if (!result.ok) { patchConfirm({ pending: false, failure: result.failure, precheck: isNetwork(result.failure) && action !== 'rotate' }); return }
      if (action === 'rotate') {
        setDisclosure({ mode: 'rotate', account, credential: result.value as IssuedCredential, open: true })
        patchConfirm({ open: false, pending: false, returnTo: 'none' })
      } else patchConfirm({ open: false, pending: false, returnTo: action === 'delete' ? 'heading' : 'trigger' })
      notify(t(`feedback.${action === 'rotate' ? 'rotated' : action === 'revoke' ? 'revoked' : 'deleted'}`, { name: label }), result.renewed)
      list.reload()
    } finally { end(key) }
  }
  const confirmFinalFocus = () => {
    const current = lastConfirm.current
    if (!current || current.returnTo === 'none') return false
    if (current.returnTo === 'heading') return heading.current ?? true
    return returnFocus(current.action, current.account.serviceAccountId)()
  }
  const escape = (close: () => void) => (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }

  const rows = list.rows
  return <div className="min-w-0 space-y-6">
    {blocked && <InlineCallout tone="warning" title={t(tenantActive ? 'notice.readOnlyTitle' : 'notice.tenantInactiveTitle')}
      description={tenantActive ? t('notice.readOnly', { role: permissions.highestRoleLabel, reason: permissions.denyReason('workspace.write') ?? '' }) : t('notice.tenantInactive')}
      actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} className="min-w-0"
      labels={{ title: t('notice.readOnlyTitle'), description: blockedReason, upgrade: '', viewUsage: '' }} />}
    <section aria-labelledby={`${id}-create`} className="min-w-0 space-y-4">
      <SectionHeader title={t('create.title')} description={t('create.help')} count={undefined} actions={[]} as="h2" bordered={false} headingId={`${id}-create`} className="min-w-0" />
      <form className="flex min-w-0 flex-col gap-3 md:flex-row md:items-end" noValidate onSubmit={(event) => { event.preventDefault(); void submitCreate() }}>
        <Field invalid={false} disabled={false} className="min-w-0 flex-1">
          <FieldLabel htmlFor={`${id}-name`}>{t('create.nameLabel')}</FieldLabel>
          <Input ref={nameInput} id={`${id}-name`} type="text" value={name} autoComplete="off" spellCheck={false} placeholder={t('create.namePlaceholder')} className={`w-full min-w-0 ${focusRing}`} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Button ref={createButton} type="submit" variant="primary" size="md" loading={create.pending} disabled={blocked || !name.trim() || create.pending} aria-busy={create.pending} iconOnly={false} icon={undefined} trailingIcon={undefined} title={blocked ? blockedReason : undefined} className={`md:min-w-24 ${focusRing}`}>
          {t(create.pending ? 'create.submitting' : 'create.submit')}
        </Button>
      </form>
      {create.failure && <div role="group" aria-label={t('failure.title.create')} onKeyDown={escape(dismissCreate)}>
        <FailureView scope="create" failure={create.failure} name={name} pending={create.pending} onRetry={() => void submitCreate()} onClose={dismissCreate} onBack={backFromCreate} onAlertShown={() => createButton.current?.focus()} />
      </div>}
    </section>

    {list.failure ? <FailureView scope="list" failure={list.failure} name="" pending={false} autoFocus={list.attempt > 0} onRetry={list.reload} onClose={list.reload} onBack={onChooseWorkspace} />
      : !rows ? <section role="status" aria-label={t('states.loading')} aria-busy={true} className="min-w-0"><Text as="p" variant="body" tone="muted">{t('states.loadingDescription')}</Text><TableSkeleton rows={3} columns={6} label={t('states.loading')} className="min-w-0" /></section>
        : !rows.length ? <EmptyState icon={undefined} title={t('states.empty')} description={t('states.emptyDescription')} primaryAction={null} secondaryAction={null} titleAs="h2" bordered={false} className="min-w-0" />
          : <AccountsTable rows={rows} blocked={blocked} blockedReason={blockedReason} busy={busy} onReveal={(account) => void reveal(account)}
            onConfirm={(action, account, trigger) => setConfirm({ action, account, trigger, open: true, pending: false, failure: null, precheck: false, returnTo: 'trigger' })} />}
    <p id={credentialHelpId} className="sr-only">{t('table.credentialHelp')}</p>
    <div role="group" aria-label={t('failure.title.issue')} className="min-w-0" onKeyDown={escape(dismissIssue)} hidden={!issue?.failure}>
      {issue?.failure && <FailureView scope="issue" failure={issue.failure} name={accountName(issue.account)} pending={issue.pending} onRetry={() => void reveal(issue.account)} onClose={dismissIssue} onBack={backFromIssue}
        onAlertShown={() => (document.querySelector<HTMLElement>(triggerSelector('reveal', issue.account.serviceAccountId)))?.focus()} />}
    </div>

    {confirm && <ConfirmDialog action={confirm.action} account={confirm.account} open={confirm.open} pending={confirm.pending} failure={confirm.failure}
      onConfirm={() => void submitConfirm(false)} onRetry={() => void submitConfirm(true)} onClose={() => patchConfirm({ open: false, returnTo: 'trigger' })}
      onBack={() => { patchConfirm({ open: false, returnTo: 'heading' }); list.reload() }} onClosed={() => setConfirm(null)} finalFocus={confirmFinalFocus} />}
    {disclosure && <Disclosure mode={disclosure.mode} credential={disclosure.credential} open={disclosure.open} onClose={() => setDisclosure((current) => current && { ...current, open: false })} onClosed={() => setDisclosure(null)}
      finalFocus={() => returnFocus(disclosure.mode, disclosure.account.serviceAccountId)()} />}
  </div>
}
