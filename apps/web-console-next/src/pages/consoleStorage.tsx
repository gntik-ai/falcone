import { useEffect, useLayoutEffect, useRef } from 'react'
import { Alert, Badge, I18nProvider, LiveAnnouncer, Page, SimpleSelect, Field, FieldLabel, Timestamp, StatusTag, Link, Text, Toolbar, ToolbarStart, ToolbarEnd, ToolbarButton } from '@gntik-ai/ui'
import { PageHeader } from '@gntik-ai/blocks'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import { Action, Empty, FailurePanel, Heading, Loading, Notice, Table, TextField } from './consoleStorage/States'
import { DeleteDialog } from './consoleStorage/Dialogs'
import { Detail } from './consoleStorage/Detail'
import { Usage } from './consoleStorage/Usage'
import { useStorage } from './consoleStorage/useStorage'
import { focus, focusRing, useCopy } from './consoleStorage/copy'
import './consoleStorage/page.css'

function Surface({ workspace }: { workspace: string }) {
  const { t, i18n } = useCopy()
  const s = useStorage(workspace)
  const nameRef = useRef<HTMLInputElement>(null)
  const deleteOpener = useRef<HTMLElement | null>(null)
  const exportOpener = useRef<HTMLElement | null>(null)
  const noWorkspace = () => { window.location.assign('/console/workspaces') }
  useEffect(() => { if (s.showCreate) nameRef.current?.focus() }, [s.showCreate])
  const section = (kind: 'buckets' | 'usage') => s[kind].failure ? <FailurePanel section={kind} failure={s[kind].failure!} busy={s[kind].busy} retry={() => { void (kind === 'buckets' ? s.loadBuckets() : s.loadUsage()) }} back={noWorkspace} backLabel={t('selectWorkspace')} /> : s[kind].busy ? <Loading label={t('loading')} /> : null
  const date = (input?: string) => input && Number.isFinite(Date.parse(input)) ? <Timestamp value={input} format="relative" locale={i18n.language} tooltip={false} live={false} dateOptions={undefined} /> : t('none')
  const status = (input?: string) => {
    const label = input ? t(`enums.${input}`, { defaultValue: input.replace(/_/g, ' ') }) : t('none')
    return <StatusTag status={input ?? 'unknown'} statuses={{ [input ?? 'unknown']: { label, tone: input && ['failed', 'error', 'provider_unavailable', 'suspended'].includes(input) ? 'destructive' : input === 'active' || input === 'ok' ? 'success' : 'neutral' } }} label={label} uppercase={false} variant="soft" size="sm" shape="rounded" className="max-w-full" />
  }
  const rows = s.buckets.data?.items ?? []
  return <>
    <div className="storage-layout">
      <div className="min-w-0 space-y-8">
        <section className="min-w-0 space-y-4" aria-labelledby="storage-buckets-heading">
          <div id="storage-buckets-heading" tabIndex={-1} className={focusRing}><Heading title={t('buckets')} description={t('bucketsDescription')} /></div>
          {/* Resource-index composition keeps the legacy two-column body and truncated inventory.
              The template's built-in client paging and filter UI would change these semantics. */}
          <Toolbar variant="plain" aria-label={t('actions')} className="flex min-w-0 flex-wrap gap-2"><ToolbarStart><Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{t('visible', { count: rows.length })}</Badge></ToolbarStart><ToolbarEnd><ToolbarButton id="storage-new-bucket" variant="secondary" size="sm" icon={undefined} disabled={s.mutations.create.busy} aria-expanded={s.showCreate} aria-controls="storage-create-form" className={focusRing} onClick={() => s.setShowCreate(!s.showCreate)}>{t(s.showCreate ? 'close' : 'newBucket')}</ToolbarButton></ToolbarEnd></Toolbar>
          {s.showCreate && <form id="storage-create-form" data-testid="storage-create" className="min-w-0 space-y-4 rounded-lg border border-border p-4" aria-busy={s.mutations.create.busy} onSubmit={(event) => { event.preventDefault(); if (!s.mutations.create.failure) void s.perform('create') }}>
            {s.mutations.create.failure && <FailurePanel section="create" failure={s.mutations.create.failure} busy={s.mutations.create.busy} retry={() => { void s.perform('create', true) }} close={() => { s.dismiss('create'); s.setShowCreate(false); focus('storage-new-bucket') }} autoFocus={true} back={noWorkspace} backLabel={t('selectWorkspace')} />}
            <TextField id="storage-create-name" label={t('bucketName')} help={t('bucketHelp')} placeholder={t('bucketPlaceholder')} value={s.name} onChange={s.setName} inputRef={nameRef} busy={s.mutations.create.busy} />
            {!s.mutations.create.failure && <Action type="submit" variant="primary" busy={s.mutations.create.busy}>{t(s.mutations.create.busy ? 'creating' : 'create')}</Action>}
            <Action disabled={s.mutations.create.busy} onClick={() => { s.setShowCreate(false); s.setName(''); s.dismiss('create') }}>{t('cancel')}</Action>
          </form>}
          {section('buckets')}
          {!s.buckets.busy && !s.buckets.failure && s.buckets.data && (rows.length ? <Table rows={rows} id={(row) => row.resourceId} label={t('buckets')} columns={[
            { id: 'name', header: t('name'), sortable: false, cell: (row) => <div className="min-w-0"><Action variant="ghost" aria-pressed={s.bucket?.resourceId === row.resourceId} onClick={() => s.selectBucket(row)}>{row.bucketName}</Action><div className="text-xs text-muted-foreground">{row.resourceId}</div></div> },
            { id: 'region', header: t('region'), sortable: false, cell: (row) => row.region ?? t('none') },
            { id: 'status', header: t('status'), sortable: false, cell: (row) => status(row.status) },
            { id: 'provisioning', header: t('provisioning'), sortable: false, cell: (row) => status(row.provisioning?.state) },
            { id: 'created', header: t('createdAt'), sortable: false, cell: (row) => date(row.timestamps?.createdAt) },
            { id: 'actions', header: t('actions'), sortable: false, cell: (row) => <div className="flex flex-wrap gap-2"><Action aria-label={t('exportBucket', { name: row.bucketName })} busy={s.exporting?.resourceId === row.resourceId && s.mutations.export.busy} disabled={s.mutations.export.busy} onClick={(event) => { exportOpener.current = event.currentTarget; s.setExporting(row); s.dismiss('export'); void s.perform('export', false, row) }}>{t(s.exporting?.resourceId === row.resourceId && s.mutations.export.busy ? 'exporting' : 'export')}</Action><Action variant="destructive" aria-label={t('deleteBucket', { name: row.bucketName })} onClick={(event) => { deleteOpener.current = event.currentTarget; s.setDeleting(row); s.dismiss('delete') }}>{t('delete')}</Action></div> },
          ]} /> : <Empty title={t('noBuckets')} description={t('noBucketsDescription')} action={<Action onClick={() => s.setShowCreate(true)}>{t('createFirst')}</Action>} />)}
          {s.exporting && <ExportRegion state={s} opener={exportOpener} />}
        </section>
        <section className="min-w-0 space-y-4" aria-label={t('usage')}><Heading title={t('usage')} description={t('usageDescription')} />{section('usage')}{s.usage.data && !s.usage.failure && !s.usage.busy && <Usage state={s} />}</section>
      </div>
      <Detail state={s} />
    </div>
    <div aria-live="polite" aria-atomic="true" className="min-w-0">{s.notice && <Notice tone={s.notice.key === 'outcomeUnknown' ? 'warning' : 'success'}>{t(s.notice.key, s.notice.values)}</Notice>}</div>
    {s.deleting && <DeleteDialog key={s.deleting.resourceId} state={s} opener={deleteOpener} />}
  </>
}

// Export failures remain local to the bucket named in this region.
function ExportRegion({ state: s, opener }: { state: ReturnType<typeof useStorage>; opener: React.RefObject<HTMLElement | null> }) {
  const { t } = useCopy()
  return <section aria-label={t('exportBucket', { name: s.exporting!.bucketName })} className="min-w-0 space-y-3">
    <Heading title={t('exportBucket', { name: s.exporting!.bucketName })} level="h3" />
    {s.mutations.export.failure && <FailurePanel section="export" failure={s.mutations.export.failure} busy={s.mutations.export.busy} retry={() => { void s.perform('export', true) }} close={() => { s.dismiss('export'); s.setExporting(null); opener.current?.focus() }} autoFocus={true} back={() => { s.setExporting(null); focus('storage-buckets-heading') }} backLabel={t('backBuckets')} />}
    {s.mutations.export.busy && !s.mutations.export.failure && <Loading label={t('exporting')} />}
  </section>
}

function WorkspaceGate() {
  const { t } = useCopy()
  const context = useConsoleContext()
  const { can } = usePermissions()
  if (context.loading) return <section role="status" aria-label={t('workspaceLoading')}><Heading title={t('workspaceLoading')} description={t('workspaceLoadingDescription')} /><Loading label={t('workspaceLoading')} /></section>
  if (context.error) return <FailurePanel section="workspaceRequired" failure={context.error} busy={context.loading} retry={() => { void context.reloadWorkspaces?.() }} />
  const action = context.workspaces.length ? <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor="storage-workspace">{t('workspacePicker')}</FieldLabel><SimpleSelect id="storage-workspace" value="" defaultValue="" placeholder={t('workspacePlaceholder')} clearable={false} size="md" items={context.workspaces.map((item) => ({ value: item.workspaceId, label: item.displayName }))} onValueChange={(id) => context.selectWorkspace(id || null)} className="w-full min-w-0" /></Field>
    : can('tenant.workspaces.create') ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t('workspaceCreate')}</Link>
      : <Text as="p" variant="body" tone="muted">{t('workspaceDenied')}</Text>
  return <Empty title={t('workspaceRequired')} description={t('workspaceDescription')} action={action} />
}

export default function ConsoleStoragePage() {
  const { t, i18n } = useCopy()
  const context = useConsoleContext()
  const heading = useRef<HTMLHeadingElement>(null)
  const key = JSON.stringify([context.activeTenantId, context.activeWorkspaceId])
  const previous = useRef(key)
  useLayoutEffect(() => { if (previous.current !== key) { previous.current = key; heading.current?.focus() } }, [key])
  return <I18nProvider locale={i18n.language} messages={{ 'common.close': t('close'), 'common.cancel': t('cancel'), 'common.loading': t('loading') }}><LiveAnnouncer>
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="console-storage min-w-0 space-y-6 break-words" data-testid="storage-page"
      header={<div><PageHeader as="header" wrapTitle={true} titleRef={(node) => { heading.current = node; if (node) { node.id = 'storage-heading'; node.classList.add(...focusRing.split(' ')) } }} tab="" defaultTab="" onTabChange={undefined} title={t('title')} description={t('description')} breadcrumbs={[]} status="" statuses={{}} meta={[]} tabs={null} actions={[]} labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('actions') }} /></div>}>
      {!context.activeTenantId ? <Alert tone="info" role="status" title={undefined} description={t('noTenant')} actions={null} icon={undefined} onDismiss={undefined} dismissLabel="" />
        : !context.activeWorkspaceId ? <WorkspaceGate />
          : <Surface key={key} workspace={context.activeWorkspaceId} />}
    </Page>
  </LiveAnnouncer></I18nProvider>
}
