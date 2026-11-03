import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge, Button, Checkbox, CopyButton, EmptyState, Link, Page, StatusTag, Text, Toolbar, ToolbarButton, ToolbarEnd, useAnnounce, useToast } from '@gntik-ai/ui'
import { DataTable, ErrorPanel, FormSection, InlineCallout, ListSkeleton, NoAccessEmpty, NotFoundEmpty, PageHeader, SectionHeader, StickyActionBar, TableSkeleton, type DataTableColumn } from '@gntik-ai/blocks'
import {
  deleteTenantIdentityProvider, getTenantAuthConfig, updateTenantAuthConfig, upsertTenantIdentityProvider,
  type TenantAuthConfig, type TenantAuthConfigBooleanKey, type TenantIdentityProvider,
} from '@in-falcone/console-api/auth-config'
import { useConsoleContext } from '../../shell/context'
import { usePermissions } from '../../shell/permissions'
import { BOOLEAN_KEYS, buildPatch, callbackPath, describeFailure, draftFromConfig, failureFrom, isDirty, type BooleanDraft, type Failure } from './model'
import { ProviderDialog } from './ProviderDialog'
import { DeleteDialog } from './DeleteDialog'

const NAMESPACE = 'pages.console-auth-config-page'
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring'
type Opener = { element: HTMLElement | null; key: string }

export function AuthConfigConsole() {
  const { t } = useTranslation(NAMESPACE)
  const announce = useAnnounce()
  const toast = useToast()
  const { activeTenantId, tenants, loading: contextLoading } = useConsoleContext()
  const canManage = usePermissions().can('tenant.auth-config.manage')
  const [config, setConfig] = useState<TenantAuthConfig | null>(null)
  const [draft, setDraft] = useState<BooleanDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ provider: TenantIdentityProvider | null } | null>(null)
  const [deleting, setDeleting] = useState<{ alias: string; name: string } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const noticeRegion = useRef<HTMLDivElement>(null)
  const focusNotice = useRef(false)
  const retried = useRef(false)
  const opener = useRef<Opener>({ element: null, key: '' })
  const currentTenant = useRef(activeTenantId)
  currentTenant.current = activeTenantId
  const tenantLabel = tenants.find((tenant) => tenant.tenantId === activeTenantId)?.displayName

  // A tenant switch drops everything belonging to the previous tenant.
  useEffect(() => {
    setDialog(null); setDeleting(null); setConfig(null); setDraft(null); setFailure(null); setSaveError(null); setNotice(null); setSaving(false)
  }, [activeTenantId])

  useEffect(() => {
    if (!activeTenantId) { setLoading(false); return undefined }
    const controller = new AbortController()
    setLoading(true); setFailure(null)
    getTenantAuthConfig(activeTenantId, controller.signal).then((data) => {
      if (controller.signal.aborted) return
      setConfig(data); setDraft(draftFromConfig(data))
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      setConfig(null); setDraft(null); setFailure(failureFrom(cause))
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [activeTenantId, attempt])

  // A failed retry keeps focus on the page; the title is the stable landmark.
  useEffect(() => {
    if (!loading && retried.current) { heading.current?.focus(); retried.current = false }
  }, [loading])

  // After a save the primary control disables itself, so focus would fall to <body>. The result
  // region takes it instead; only the save path arms the flag.
  useEffect(() => {
    if (notice && focusNotice.current) { focusNotice.current = false; noticeRegion.current?.focus() }
  }, [notice])

  const reload = useCallback(() => setAttempt((count) => count + 1), [])
  const succeed = useCallback((message: string) => {
    setNotice(message); toast.add({ title: message, description: undefined, tone: 'success', priority: 'low' }); announce(message, 'polite')
  }, [announce, toast])
  const fail = useCallback((message: string) => { setSaveError(message); announce(message, 'assertive') }, [announce])

  function remember(key: string) {
    opener.current = { element: document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null, key }
  }
  function returnFocus(): HTMLElement | null {
    const { element, key } = opener.current
    if (element?.isConnected) return element
    const selector = key === 'create' ? '[role="toolbar"] button' : `[data-auth-config-trigger="${key}"]`
    return root.current?.querySelector<HTMLElement>(selector) ?? heading.current
  }

  const dirty = Boolean(config && draft && isDirty(config, draft))
  function toggleField(key: TenantAuthConfigBooleanKey, checked: boolean) {
    // Editing invalidates the previous save's outcome.
    setDraft((current) => current ? { ...current, [key]: checked } : current)
    setNotice(null); setSaveError(null)
  }
  function discard() {
    if (!config) return
    setDraft(draftFromConfig(config)); setNotice(null); setSaveError(null)
  }
  async function save() {
    if (!canManage || !activeTenantId || !config || !draft) return
    const patch = buildPatch(config, draft)
    if (Object.keys(patch).length === 0) return
    const tenantId = activeTenantId
    setSaving(true); setSaveError(null); setNotice(null)
    try {
      const updated = await updateTenantAuthConfig(tenantId, patch)
      if (currentTenant.current !== tenantId) return
      setConfig(updated); setDraft(draftFromConfig(updated))
      focusNotice.current = true
      succeed(t('saved'))
    } catch (cause) {
      if (currentTenant.current === tenantId) fail(describeFailure(t, cause, t('saveFailed')))
    } finally { if (currentTenant.current === tenantId) setSaving(false) }
  }

  function providersSaved(tenantId: string, providers: TenantIdentityProvider[]) {
    if (currentTenant.current !== tenantId) return
    setConfig((current) => current ? { ...current, identityProviders: providers } : current)
    succeed(t('providerUpdated'))
  }
  async function toggleProvider(provider: TenantIdentityProvider) {
    if (!canManage || !activeTenantId) return
    const tenantId = activeTenantId
    setSaving(true); setSaveError(null)
    try {
      const result = await upsertTenantIdentityProvider(tenantId, provider.alias, { providerId: provider.providerId, enabled: !provider.enabled })
      providersSaved(tenantId, result.identityProviders)
    } catch (cause) {
      if (currentTenant.current === tenantId) fail(failureFrom(cause).status === 409 ? t('providerConflict') : describeFailure(t, cause, t('providerUpdateFailed')))
    } finally { if (currentTenant.current === tenantId) setSaving(false) }
  }

  const providers = config?.identityProviders ?? []
  const nameOf = (provider: TenantIdentityProvider) => provider.displayName || provider.alias
  const columns: DataTableColumn<TenantIdentityProvider>[] = config ? [
    { id: 'provider', header: t('columnProvider'), sortable: false, cell: (provider) => <div className="min-w-0 wrap-anywhere">
      <p className="font-medium text-foreground">{nameOf(provider)}</p>
      <p className="font-mono text-xs text-muted-foreground">{t('aliasLine', { alias: provider.alias })}</p></div> },
    { id: 'type', header: t('columnType'), sortable: false, variant: 'mono', cell: (provider) => provider.providerId },
    { id: 'status', header: t('columnStatus'), sortable: false, cell: (provider) => <StatusTag status={provider.enabled ? 'enabled' : 'disabled'} label={t(provider.enabled ? 'enabled' : 'disabled')}
      statuses={{ enabled: { label: t('enabled'), tone: 'success' }, disabled: { label: t('disabled'), tone: 'neutral' } }} uppercase={false} /> },
    { id: 'secret', header: t('columnSecret'), sortable: false, cell: (provider) => <Badge tone={provider.clientSecretSet ? 'success' : 'neutral'} variant="soft" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{t(provider.clientSecretSet ? 'secretSet' : 'secretNotSet')}</Badge> },
    { id: 'callback', header: t('columnCallback'), sortable: false, cell: (provider) => provider.callbackUrl
      ? <div className="min-w-0 space-y-1.5"><code className="block break-all font-mono text-xs">{provider.callbackUrl}</code>
          <CopyButton value={provider.callbackUrl} display="label" label={t('copyUrl')} copiedLabel={t('copyUrlDone')} failureLabel={t('copyUrlFailed')} announcement={t('urlCopied')} failureAnnouncement={t('copyFailed')}
            variant="secondary" size="sm" tooltip={false} aria-label={t('copyUrlNamed', { name: nameOf(provider) })} className={focusRing}
            onCopy={() => setNotice(t('urlCopied'))} onCopyError={() => setSaveError(t('copyFailed'))} /></div>
      : <Text variant="supporting" tone="muted" className="min-w-0 wrap-anywhere">{t('callbackHint', { path: callbackPath(config.realm, provider.alias) })}</Text> },
    ...(canManage ? [{ id: 'actions', header: t('columnActions'), sortable: false, cell: (provider: TenantIdentityProvider) => <div className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" size="sm" disabled={saving} aria-label={t('editNamed', { name: nameOf(provider) })} data-auth-config-trigger={`edit:${provider.alias}`} className={focusRing}
        onClick={() => { remember(`edit:${provider.alias}`); setDialog({ provider }) }}>{t('edit')}</Button>
      <Button type="button" variant="secondary" size="sm" disabled={saving} aria-label={t(provider.enabled ? 'disableNamed' : 'enableNamed', { name: nameOf(provider) })} data-auth-config-trigger={`toggle:${provider.alias}`} className={focusRing}
        onClick={() => void toggleProvider(provider)}>{t(provider.enabled ? 'disable' : 'enable')}</Button>
      <Button type="button" variant="destructive" size="sm" disabled={saving} aria-label={t('deleteNamed', { name: nameOf(provider) })} data-auth-config-trigger={`delete:${provider.alias}`} className={focusRing}
        onClick={() => { remember(`delete:${provider.alias}`); setDeleting({ alias: provider.alias, name: nameOf(provider) }) }}>{t('delete')}</Button></div> }] : []),
  ] : []

  const noticeBlock = notice && <div ref={noticeRegion} role="region" tabIndex={-1} aria-label={t('announcementRegion')} className={`rounded-lg ${focusRing}`}>
    <InlineCallout tone="success" title={notice} description={undefined} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined}
      labels={{ title: notice, description: '', upgrade: '', viewUsage: '' }} /></div>

  const methods = config && draft && <FormSection labels={{ title: t('methodsTitle'), description: t('methodsDescription') }} headingLevel="h2" divided={false} className="min-w-0"
    title={<span id="auth-config-methods-heading">{t('methodsTitle')}</span>} description={t('methodsDescription')}>
    <div className="min-w-0 space-y-4">
      {saveError && <InlineCallout tone="destructive" title={t('saveErrorTitle')} description={saveError} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined}
        labels={{ title: t('saveErrorTitle'), description: saveError, upgrade: '', viewUsage: '' }} />}
      <div role="group" aria-labelledby="auth-config-methods-heading" className="min-w-0 divide-y divide-border rounded-lg border border-border">
        {BOOLEAN_KEYS.map((key) => <div key={key} className="p-4">
          <Checkbox label={t(`methods.${key}.label`)} description={t(`methods.${key}.help`)} checked={draft[key]} disabled={saving || !canManage || loading}
            onCheckedChange={(checked) => toggleField(key, checked === true)} />
        </div>)}
      </div>
    </div>
  </FormSection>

  const providerBody = !config ? null : providers.length === 0
    ? (canManage
      ? <EmptyState icon={undefined} title={t('emptyProviders')} description={t('emptyProvidersDescription', { realm: config.realm })} titleAs="h3" bordered={false} secondaryAction={null} className="min-w-0"
          primaryAction={<Button type="button" variant="primary" disabled={saving} className={focusRing} onClick={() => { remember('create'); setDialog({ provider: null }) }}>{t('createProvider')}</Button>} />
      : <EmptyState icon={undefined} title={t('emptyProviders')} description={t('emptyProvidersRead')} titleAs="h3" bordered={false} primaryAction={null} secondaryAction={null} className="min-w-0" />)
    : <div className="min-w-0 space-y-3">
        {/* The legacy list has no search or filters, so the toolbar holds only its primary action: the kit's toolbar primitives keep the single Tab stop on Crear proveedor. */}
        {canManage && <Toolbar aria-label={t('toolbarLabel')} className="min-w-0">
          <ToolbarEnd className="ms-auto">
            <ToolbarButton variant="primary" disabled={saving} className={focusRing} onClick={() => { remember('create'); setDialog({ provider: null }) }}>{t('createProvider')}</ToolbarButton>
          </ToolbarEnd>
        </Toolbar>}
        <DataTable rows={providers} columns={columns} getRowId={(provider) => provider.alias} getRowLabel={nameOf} caption={t('providersTable')} showCaption={false} paginated={false}
          selectable={false} selectionMode="none" selectedIds={[]} selectionSummary={false} rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null}
          showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false} views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} className="auth-config-table min-w-0"
          labels={{ scrollRegion: t('providersTable'), emptyTitle: t('emptyProviders'), emptyDescription: t('emptyProviders'), loading: () => t('loading') }} />
      </div>

  const panelLabels = { support: t('support'), retry: t('retry'), retrying: t('retrying'), retryingStatus: t('retrying'), requestId: t('requestId'), copyRequestId: t('copyRequestId'), copied: t('copied'), requestIdCopied: t('copied'), details: t('details') }
  let body
  if (contextLoading || loading) {
    body = <section role="status" aria-label={t('loading')} aria-busy={true}><Text variant="body" tone="muted">{t('loadingDescription')}</Text>
      <div aria-hidden={true} className="space-y-6"><ListSkeleton rows={5} label={t('loading')} className="min-w-0" /><TableSkeleton rows={3} columns={4} label={t('loading')} className="min-w-0" /></div></section>
  } else if (!activeTenantId) {
    body = <EmptyState icon={undefined} title={t('selectOrganization')} description={t('selectOrganizationDescription')} titleAs="h2" bordered={false} primaryAction={null} secondaryAction={null} className="min-w-0" />
  } else if (failure?.status === 401) {
    body = null
  } else if (failure?.status === 403) {
    // The backend reason is never shown; the localized permission text replaces it.
    body = <NoAccessEmpty resource={t('title')} owner="" onRequestAccess={undefined} showRequestAccess={false} action={undefined} defaultRequested={false} titleAs="h2" bordered={false} className="min-w-0"
      labels={{ title: () => t('noAccess'), description: () => t('errors.403'), request: '', requested: '', sent: '' }} />
  } else if (failure?.status === 404) {
    body = <NotFoundEmpty icon={undefined} title={t('notFound')} description={t('notFoundDescription')} titleAs="h2" bordered={false} className="min-w-0"
      action={<Link render={<RouterLink to="/console/overview" />} underline="always" external={false} externalLabel="">{t('backToOverview')}</Link>} />
  } else if (failure) {
    const message = describeFailure(t, failure, t('loadFallback'))
    body = <ErrorPanel title={t('loadError')} message={message} code={failure.status ?? null} requestId={failure.requestId ?? ''} details="" secondaryAction={null} titleAs="h2" announce={true} retryLabel={t('retry')} retrying={false} className="min-w-0"
      onRetry={() => { retried.current = true; reload() }} labels={{ ...panelLabels, title: t('loadError'), message }} />
  } else if (config && draft) {
    body = <div ref={root} className="min-w-0 space-y-6" data-testid="auth-config-ready">
      {noticeBlock}
      {methods}
      {canManage && <StickyActionBar dirty={dirty} saving={saving} onSave={() => void save()} onCancel={discard} dirtyMessage={t('unsaved')} cleanMessage={t('clean')} saveLabel={t('save')} cancelLabel={t('discard')} hideWhenClean={false} aria-label={t('actionBar')} className="min-w-0" />}
      <section aria-labelledby="auth-config-providers-heading" className="min-w-0 space-y-4">
        <SectionHeader title={t('providersTitle')} description={t(canManage ? 'providersDescriptionManage' : 'providersDescriptionRead')} count={providers.length} actions={[]} as="h2" bordered={true} headingId="auth-config-providers-heading" className="min-w-0" />
        {providerBody}
      </section>
    </div>
  }

  const label = tenantLabel ?? activeTenantId ?? ''
  const header = <PageHeader as="div" wrapTitle={true} title={t('title')} titleRef={heading} description={t('description', { tenant: tenantLabel ?? t('activeTenant') })} breadcrumbs={[]} status="" statuses={{}} tabs={null}
    meta={activeTenantId ? [{ label: t('organization'), value: label, mono: false }, ...(config ? [{ label: t('realm'), value: config.realm, mono: true }] : [])] : []}
    actions={activeTenantId ? [{ id: 'reload', label: t('reload'), variant: 'secondary', disabled: loading || contextLoading || saving, onClick: reload }] : []}
    labels={{ title: t('title'), description: t('title'), moreActions: t('title'), sections: t('title') }} />

  return <>
    <Page width="wide" header={header} title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actionBar')} aria-label={t('consoleLabel')} className="console-auth-config min-w-0 space-y-6 wrap-anywhere" data-testid="console-auth-config-page">
      {body}
    </Page>
    {canManage && dialog && activeTenantId && config && <ProviderDialog key={dialog.provider?.alias ?? 'new'} tenantId={activeTenantId} provider={dialog.provider} aliases={providers.map((provider) => provider.alias)}
      returnFocus={returnFocus} onClose={() => setDialog(null)} onSaved={(next) => providersSaved(activeTenantId, next)} />}
    {canManage && deleting && activeTenantId && <DeleteDialog name={deleting.name} returnFocus={returnFocus} onClose={() => setDeleting(null)}
      onConfirm={async () => {
        await deleteTenantIdentityProvider(activeTenantId, deleting.alias)
        succeed(t('providerDeleted', { name: deleting.name })); reload()
      }} />}
  </>
}
