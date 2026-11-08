import { useCallback, useMemo, useRef, useState } from 'react'
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Badge, Button, Text, useAnnounce, useToast } from '@gntik-ai/ui'
import { PageToolbar, SectionHeader, type DataTableColumn } from '@gntik-ai/blocks'
import {
  detachProvider, failureOf, listApplications, saveApplication, saveProvider, softDeleteApplication, toggleProvider,
  type Application, type ApplicationForm, type Failure, type Provider, type ProviderForm,
} from './api'
import { ApplicationFormView, ProviderFormView } from './Forms'
import { Action, Callout, Empty, Grid, Loading, SectionFailure, focusRing, useCopy, useFailureText, useLoadState } from './ui'

type Confirm = { kind: 'delete'; application: Application; trigger: string } | { kind: 'detach'; application: Application; provider: Provider; trigger: string }
const trigger = (kind: string, id: string) => `${kind}:${id}`
const selector = (key: string) => `[data-auth-trigger="${key}"]`

function Chip({ children }: { children: string }) {
  return <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{children}</Badge>
}
function Enabled({ value }: { value: boolean }) {
  const { t } = useCopy()
  return <Badge tone={value ? 'success' : 'neutral'} variant={value ? 'soft' : 'outline'} size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{t('labelValue', { label: t('provider.enabled'), value: t(value ? 'yes' : 'no') })}</Badge>
}
const list = (values?: string[]) => values && values.length ? values.join(', ') : '—'

export function Applications({ workspaceId }: { workspaceId: string | null }) {
  const { t } = useCopy()
  const announce = useAnnounce(), toast = useToast(), failureText = useFailureText()
  const [revision, setRevision] = useState(0)
  const [formMode, setFormMode] = useState<{ kind: 'create' } | { kind: 'edit'; id: string } | null>(null)
  const [panelId, setPanelId] = useState<string | null>(null)
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  const [providerKey, setProviderKey] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ value: Confirm; open: boolean; pending: boolean; error: string | null } | null>(null)
  const inFlight = useRef(false)
  const blocked = !workspaceId
  const load = useCallback((signal: AbortSignal) => workspaceId ? listApplications(workspaceId, signal) : Promise.resolve([]), [workspaceId])
  const { current: result, last } = useLoadState(load, revision)
  const applications = result?.data ?? []
  const visible = applications.filter((application) => application.state !== 'soft_deleted')
  // The open forms and the provider panel read the last settled list, so a reload after an unrelated successful
  // mutation does not unmount them or discard what was typed. The tables above never show it as fresh.
  const known = last?.data ?? []
  const refreshing = result === null && known.length > 0
  const editing = formMode?.kind === 'edit' ? known.find((application) => application.applicationId === formMode.id) ?? null : null
  const providerApplication = known.find((application) => application.applicationId === panelId) ?? null
  const providerRows = useMemo(() => applications.flatMap((application) => (application.federatedProviders ?? []).map((provider) => ({ ...provider, applicationLabel: application.displayName || application.slug }))), [applications])

  // The single place a successful mutation reports: one toast, one announcement, one list reload.
  function succeeded(message: string) {
    toast.add({ title: message, description: undefined, tone: 'success', priority: 'low' })
    announce(message, 'polite')
    setRevision((value) => value + 1)
  }
  // Runs one mutation at a time. A form shows its own failure; a row action reports it in the section.
  async function mutate(send: () => Promise<void>, done: string, fallback: string, inline: boolean): Promise<string | null> {
    if (inFlight.current) return ''
    inFlight.current = true; setBusy(true); setNotice(null)
    try { await send(); succeeded(done); return null }
    catch (cause) {
      const message = failureText(failureOf(cause), fallback)
      if (!inline) setNotice(message)
      announce(message, 'assertive')
      return message
    }
    finally { inFlight.current = false; setBusy(false) }
  }

  const saveApp = async (form: ApplicationForm) => {
    if (!workspaceId) return t('feedback.selectWorkspaceSave')
    const message = await mutate(() => saveApplication(workspaceId, form, editing), t(editing ? 'feedback.appUpdated' : 'feedback.appCreated'), t('feedback.appSaveFailed'), true)
    if (message === null) closeForm(true)
    return message
  }
  const saveProv = async (form: ProviderForm) => {
    if (!workspaceId || !providerApplication) return t('feedback.selectApplication')
    const wasEditing = editingProvider
    const message = await mutate(() => saveProvider(workspaceId, providerApplication, form, wasEditing?.providerId ?? null), t(wasEditing ? 'feedback.providerUpdated' : 'feedback.providerAdded'), t('feedback.providerSaveFailed'), true)
    if (message === null) { setEditingProvider(null); setProviderKey((value) => value + 1) }
    return message
  }
  async function toggle(provider: Provider) {
    if (!workspaceId || !providerApplication) return
    await mutate(() => toggleProvider(workspaceId, providerApplication, provider), t('feedback.providerToggled', { alias: provider.alias }), t('feedback.toggleFailed'), false)
  }
  async function runConfirm() {
    if (!confirm || !workspaceId || inFlight.current) return
    const { value } = confirm
    inFlight.current = true; setBusy(true); setNotice(null); setConfirm({ ...confirm, pending: true, error: null })
    try {
      if (value.kind === 'delete') {
        await softDeleteApplication(workspaceId, value.application)
        succeeded(t('feedback.appDeleted', { name: value.application.displayName }))
      } else {
        await detachProvider(workspaceId, value.application, value.provider)
        setEditingProvider(null); setProviderKey((current) => current + 1)
        succeeded(t('feedback.providerDetached'))
      }
      setConfirm((current) => current && { ...current, open: false, pending: false })
    } catch (cause) {
      const message = failureText(failureOf(cause), t(value.kind === 'delete' ? 'feedback.deleteFailed' : 'feedback.detachFailed'))
      announce(message, 'assertive'); setConfirm((current) => current && { ...current, pending: false, error: message })
    } finally { inFlight.current = false; setBusy(false) }
  }
  // Focus goes back to the control that opened a surface; after a save the row may be gone, so the section heading takes it.
  const refocus = (target: string | null) => requestAnimationFrame(() => {
    const heading = document.getElementById('auth-applications-heading')
    if (heading) heading.tabIndex = -1
    const element = target === 'toolbar' ? document.querySelector<HTMLElement>('.auth-toolbar button') : target ? document.querySelector<HTMLElement>(selector(target)) : null
    ;(element ?? heading)?.focus()
  })
  const closeForm = (saved: boolean) => {
    const key = formMode?.kind === 'edit' ? trigger('edit', formMode.id) : 'toolbar'
    setFormMode(null); refocus(saved ? null : key)
  }
  const askConfirm = (value: Confirm) => setConfirm({ value, open: true, pending: false, error: null })
  // The row that opened the dialog is gone after a reload: focus lands on the section heading instead.
  const returnFocus = () => {
    const heading = document.getElementById('auth-applications-heading')
    if (heading) heading.tabIndex = -1
    return (confirm ? document.querySelector<HTMLElement>(selector(confirm.value.trigger)) : null) ?? heading ?? true
  }

  const open = (kind: 'create' | { edit: string }) => { setNotice(null); setFormMode(kind === 'create' ? { kind: 'create' } : { kind: 'edit', id: kind.edit }) }
  const openPanel = (id: string) => { setPanelId(id); setEditingProvider(null); setProviderKey((value) => value + 1); setNotice(null) }
  const row = (kind: string, id: string) => ({ 'data-auth-trigger': trigger(kind, id) })

  const appColumns: DataTableColumn<Application>[] = [
    { id: 'name', header: t('apps.name'), sortable: false, cell: (application) => <div><div className="font-medium">{application.displayName}</div><div className="text-xs text-muted-foreground">{application.slug}</div></div> },
    { id: 'kind', header: t('apps.kind'), sortable: false, cell: (application) => <div className="flex flex-wrap gap-2"><Chip>{t(`enums.${application.protocol}`, { defaultValue: application.protocol })}</Chip><Chip>{t(`enums.${application.state}`, { defaultValue: application.state })}</Chip></div> },
    { id: 'flows', header: t('apps.flows'), sortable: false, cell: (application) => list(application.authenticationFlows?.map((flow) => t(`flows.${flow}`, { defaultValue: flow }))) },
    { id: 'redirects', header: t('apps.redirects'), sortable: false, cell: (application) => list(application.redirectUris) },
    { id: 'scopes', header: t('apps.scopes'), sortable: false, cell: (application) => list((application.scopes ?? []).map((scope) => scope.scopeName)) },
    { id: 'validation', header: t('apps.validation'), sortable: false, cell: (application) => application.validation ? <Chip>{t(`validationStatus.${application.validation.status}`, { defaultValue: application.validation.status })}</Chip> : <Chip>{t('apps.noValidation')}</Chip> },
    { id: 'actions', header: t('apps.actions'), sortable: false, cell: (application) => <div className="flex flex-wrap gap-2">
      <Action disabled={blocked || busy} aria-label={t('apps.editNamed', { name: application.displayName })} onClick={() => open({ edit: application.applicationId })} {...row('edit', application.applicationId)}>{t('apps.edit')}</Action>
      <Action disabled={blocked || busy || application.protocol === 'api_key'} aria-label={t('apps.providersNamed', { name: application.displayName })} onClick={() => openPanel(application.applicationId)} {...row('providers', application.applicationId)}>{t('apps.providers')}</Action>
      <Action disabled={blocked || busy} aria-label={t('apps.deleteNamed', { name: application.displayName })} onClick={() => askConfirm({ kind: 'delete', application, trigger: trigger('delete', application.applicationId) })} {...row('delete', application.applicationId)}>{t('apps.delete')}</Action>
    </div> },
  ]
  const providerColumns: DataTableColumn<Provider & { applicationLabel: string }>[] = [
    { id: 'application', header: t('providers.application'), sortable: false, cell: (provider) => provider.applicationLabel },
    { id: 'alias', header: t('providers.alias'), sortable: false, cell: (provider) => <div><div className="font-medium">{provider.alias}</div><div className="text-xs text-muted-foreground">{provider.displayName}</div></div> },
    { id: 'protocol', header: t('providers.protocol'), sortable: false, cell: (provider) => <Chip>{t(`enums.${provider.protocol}`, { defaultValue: provider.protocol })}</Chip> },
    { id: 'mode', header: t('providers.mode'), sortable: false, cell: (provider) => t(`enums.${provider.providerMode}`, { defaultValue: provider.providerMode }) },
    { id: 'state', header: t('providers.state'), sortable: false, cell: (provider) => <Enabled value={provider.enabled ?? true} /> },
  ]

  const showForm = !blocked && formMode !== null && (formMode.kind === 'create' || editing !== null)
  return <section aria-labelledby="auth-applications-heading" className="min-w-0 space-y-6">
    <SectionHeader title={t('apps.title')} description={t('apps.description')} count={undefined} actions={[]} as="h2" bordered={false} headingId="auth-applications-heading" className="min-w-0" />
    <PageToolbar search="" defaultSearch="" onSearchChange={undefined} searchLabel={t('apps.toolbar')} searchPlaceholder={t('apps.toolbar')} views={[]} view="" defaultView="" onViewChange={undefined} filters={null}
      primaryAction={{ id: 'create-application', label: t('apps.createExternal'), variant: 'primary', disabled: blocked, onClick: () => open('create') }} aria-label={t('apps.toolbar')} className="auth-toolbar min-w-0" />
    {blocked && <Empty title={t('apps.selectWorkspace')} testId="auth-write-blocked" />}
    {notice && !showForm && !providerApplication && <Callout message={notice} />}
    {showForm && <ApplicationFormView key={editing?.applicationId ?? 'create'} existing={editing} onSubmit={saveApp} onCancel={() => closeForm(false)} />}
    {!blocked && (!result ? <Loading label={t('apps.loading')} columns={6} />
      : result.failure ? <SectionFailure kind="applications" section={t('apps.sectionName')} testId="auth-applications-error" failure={result.failure as Failure} onRetry={() => setRevision((value) => value + 1)} backHref="/console/workspaces" />
        : <div className="grid min-w-0 gap-6 xl:grid-cols-2">
          <section aria-label={t('apps.listTitle')} className="min-w-0 space-y-4">
            <SectionHeader title={t('apps.listTitle')} description={t('apps.listDescription')} count={undefined} actions={[]} as="h3" bordered={false} headingId={undefined} className="min-w-0" />
            {visible.length ? <Grid rows={visible} columns={appColumns} id={(application) => application.applicationId} label={t('apps.table')} empty={t('apps.empty')} /> : <Empty title={t('apps.empty')} testId="auth-apps-empty" />}
          </section>
          <section aria-label={t('providers.title')} className="min-w-0 space-y-4">
            <SectionHeader title={t('providers.title')} description={t('providers.description')} count={undefined} actions={[]} as="h3" bordered={false} headingId={undefined} className="min-w-0" />
            {providerRows.length ? <Grid rows={providerRows} columns={providerColumns} id={(provider) => `${provider.applicationLabel}-${provider.providerId}`} label={t('providers.table')} empty={t('providers.empty')} /> : <Empty title={t('providers.empty')} testId="auth-providers-empty" />}
          </section>
        </div>)}
    {providerApplication && <section aria-label={t('panel.aria', { name: providerApplication.displayName })} className="min-w-0 space-y-4">
      <SectionHeader title={t('panel.title', { name: providerApplication.displayName })} description={t('panel.description')} count={undefined} as="h3" bordered={false} headingId={undefined} className="min-w-0"
        actions={[{ id: 'close-panel', label: t('panel.close'), variant: 'secondary', disabled: false, onClick: () => { setPanelId(null); setEditingProvider(null); setNotice(null) } },
          { id: 'add-provider', label: t('panel.add'), variant: 'primary', disabled: providerApplication.protocol === 'api_key', onClick: () => { setEditingProvider(null); setProviderKey((value) => value + 1) } }]} />
      {providerApplication.protocol === 'api_key' ? <Empty title={t('panel.apiKeyUnsupported')} /> : <>
        {notice && <Callout message={notice} />}
        {(providerApplication.federatedProviders ?? []).length === 0 ? <Empty title={t('panel.empty')} testId="auth-panel-empty" /> : <ul aria-busy={refreshing} className="min-w-0 space-y-3">
          {(providerApplication.federatedProviders ?? []).map((provider) => <li key={provider.providerId} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2"><Text as="span" variant="body" tone="default" className="font-medium">{provider.alias}</Text><Chip>{t(`enums.${provider.protocol}`, { defaultValue: provider.protocol })}</Chip><Chip>{t(`enums.${provider.providerMode}`, { defaultValue: provider.providerMode })}</Chip></div>
              <Text as="p" variant="body" tone="muted">{provider.displayName}</Text>
              <Enabled value={provider.enabled ?? true} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Action disabled={refreshing} aria-label={t('panel.editNamed', { alias: provider.alias })} onClick={() => { setEditingProvider(provider); setProviderKey((value) => value + 1); setNotice(null) }}>{t('panel.edit')}</Action>
              <Action disabled={busy || refreshing} aria-label={t(provider.enabled ?? true ? 'panel.disableNamed' : 'panel.enableNamed', { alias: provider.alias })} onClick={() => void toggle(provider)}>{t(provider.enabled ?? true ? 'panel.disable' : 'panel.enable')}</Action>
              <Action disabled={busy || refreshing} aria-label={t('panel.detachNamed', { alias: provider.alias })} onClick={() => askConfirm({ kind: 'detach', application: providerApplication, provider, trigger: trigger('detach', provider.providerId) })} {...row('detach', provider.providerId)}>{t('panel.detach')}</Action>
            </div>
          </li>)}
        </ul>}
        <ProviderFormView key={`${providerApplication.applicationId}:${providerKey}`} existing={editingProvider} onSubmit={saveProv} onCancel={() => { setEditingProvider(null); setProviderKey((value) => value + 1) }} />
      </>}
    </section>}
    {confirm && <AlertDialog open={confirm.open} onOpenChange={(next) => { if (!next && inFlight.current) return; setConfirm((current) => current && { ...current, open: next }) }} onOpenChangeComplete={(next) => { if (!next) setConfirm(null) }}>
      <AlertDialogContent size="md" container={undefined} finalFocus={returnFocus} className="min-w-0 max-w-full wrap-anywhere">
        <AlertDialogHeader tone="destructive" icon={undefined}>
          <AlertDialogTitle>{t(confirm.value.kind === 'delete' ? 'confirm.deleteTitle' : 'confirm.detachTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{confirm.value.kind === 'delete' ? t('confirm.deleteDescription', { name: confirm.value.application.displayName || confirm.value.application.slug }) : t('confirm.detachDescription', { name: confirm.value.provider.alias || confirm.value.provider.displayName || confirm.value.provider.providerId })}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="mt-4 space-y-3">
          <Text variant="body" tone="muted">{t(confirm.value.kind === 'delete' ? 'confirm.deleteImpact' : 'confirm.detachImpact')}</Text>
          {confirm.error && <Callout message={confirm.error} />}
        </div>
        <AlertDialogFooter className="mt-5">
          <AlertDialogCancel disabled={confirm.pending}>{t('form.cancel')}</AlertDialogCancel>
          <Button type="button" variant="destructive" loading={confirm.pending} disabled={confirm.pending} className={focusRing} onClick={() => void runConfirm()}>{t(confirm.pending ? 'confirm.confirming' : 'confirm.confirm')}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>}
  </section>
}
