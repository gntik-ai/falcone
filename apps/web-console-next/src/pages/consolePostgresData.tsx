import { Fragment, useCallback, useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { Badge, EmptyState, Field, FieldLabel, I18nProvider, Link, LiveAnnouncer, Page, SimpleSelect, Text, ToastProvider, useHasLiveAnnouncer } from '@gntik-ai/ui'
import { PageHeader, PageToolbar } from '@gntik-ai/blocks'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import { PostgresDataEditor, type Mutations } from './consolePostgresData/Editor'
import { focusRing, useCopy } from './consolePostgresData/copy'
import { Empty, FailureView, Heading, Loading, Prompt, TextField } from './consolePostgresData/parts'
import { LocalizedToaster } from './consolePostgresData/Toaster'
import './consolePostgresData/page.css'

// Legacy WorkspaceRequiredState.tsx:35-111: loading, error with Reintentar, picker, create link or denial note.
// The page sends no request in any of these branches.
function WorkspaceGate() {
  const { t } = useCopy(), context = useConsoleContext(), { can } = usePermissions()
  if (context.loading) return <section role="status"><Heading title={t('workspace.loading')} description={t('workspace.loadingDescription')} /><Loading label={t('workspace.loading')} /></section>
  if (context.error) return <FailureView section="workspace" error={context.error} retry={() => void context.reloadWorkspaces?.()} />
  const action: ComponentProps<typeof EmptyState>['primaryAction'] = context.workspaces.length
    ? <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor="pgdata-workspace">{t('workspace.picker')}</FieldLabel><SimpleSelect id="pgdata-workspace" value="" defaultValue="" placeholder={t('workspace.placeholder')} clearable={false} size="md" items={context.workspaces.map((workspace) => ({ value: workspace.workspaceId, label: workspace.displayName }))} onValueChange={(id) => { if (id) context.selectWorkspace(id) }} className={`w-full min-w-0 ${focusRing}`} /></Field>
    : can('tenant.workspaces.create') ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t('workspace.create')}</Link>
    : <Text as="p" variant="body" tone="muted">{t('workspace.denied')}</Text>
  return <Empty title={t('workspace.required')} description={t('workspace.description')} action={action} />
}

export default function ConsolePostgresDataPage() {
  const { t, i18n } = useCopy(), context = useConsoleContext()
  const Announcer = useHasLiveAnnouncer() ? Fragment : LiveAnnouncer
  const [database, setDatabase] = useState(''), [schema, setSchema] = useState('public'), [table, setTable] = useState('')
  const [busy, setBusy] = useState(false), pending = useRef(0), dbInput = useRef<HTMLInputElement>(null), focusDb = useRef(false)
  // Pending mutations are counted here, above the editor, so changing the target cannot reset them.
  const track = useCallback(async <T,>(task: () => Promise<T>) => {
    pending.current++; setBusy(true)
    try { return await task() } finally { pending.current--; if (pending.current === 0) setBusy(false) }
  }, [])
  const mutations: Mutations = { busy, active: () => pending.current > 0, track }
  const workspaceId = context.activeWorkspaceId
  const ready = database.trim() !== '' && table.trim() !== ''
  useLayoutEffect(() => { if (focusDb.current) { focusDb.current = false; dbInput.current?.focus() } }, [database, table])
  function back() { focusDb.current = true; setDatabase(''); setSchema('public'); setTable('') }
  const fields = <div className="grid w-full min-w-0 gap-x-4 gap-y-5 sm:grid-cols-3">
    {([['pg-db', 'fields.database', 'placeholders.database', database, setDatabase], ['pg-schema', 'fields.schema', 'placeholders.schema', schema, setSchema], ['pg-table', 'fields.table', 'placeholders.table', table, setTable]] as const).map(([id, label, placeholder, value, set]) =>
      <TextField key={id} id={id} label={t(label)} placeholder={t(placeholder)} value={value} onChange={set} inputRef={id === 'pg-db' ? dbInput : undefined} />)}
  </div>
  const body = !workspaceId ? <WorkspaceGate /> : <>
    <PageToolbar search="" defaultSearch="" onSearchChange={undefined} searchLabel={t('targetLabel')} searchPlaceholder={t('targetLabel')} views={[]} view="" defaultView="" onViewChange={undefined} primaryAction={null} aria-label={t('targetLabel')} className="pgdata-toolbar min-w-0" filters={fields} />
    {ready ? <PostgresDataEditor target={{ workspaceId, databaseName: database.trim(), schemaName: schema.trim() || 'public', tableName: table.trim() }} mutations={mutations} onBack={back} /> : <Prompt title={t('prompt')} />}
  </>
  return <I18nProvider locale={i18n.language} messages={{ 'common.close': t('close'), 'common.cancel': t('cancel'), 'common.loading': t('rows.loading'), 'common.copy': t('keys.copy'), 'common.copied': t('keys.copied'), 'common.copyFailed': t('copyFailed') }}><Announcer><ToastProvider timeout={5000} limit={3} toastManager={undefined}>
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('title')} className="pgdata min-w-0 space-y-6 wrap-anywhere" data-testid="postgres-data-page"
      header={<PageHeader as="div" wrapTitle={true} title={t('title')} description={t('description')} breadcrumbs={[]} status="" statuses={{}} meta={[{ label: '', value: <Badge tone="neutral" variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{t('category')}</Badge> }]} tabs={null} actions={[]} labels={{ title: t('title'), description: t('description'), moreActions: t('title'), sections: t('title') }} />}>
      {body}
    </Page><LocalizedToaster />
  </ToastProvider></Announcer></I18nProvider>
}
