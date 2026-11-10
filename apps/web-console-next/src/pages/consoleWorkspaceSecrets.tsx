import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react'
import { Alert, Badge, EmptyState, Field, FieldLabel, I18nProvider, Link, LiveAnnouncer, Page, SimpleSelect, Text, Toolbar, ToolbarButton, ToolbarEnd, ToastProvider, useAnnounce, useToast } from '@gntik-ai/ui'
import { ErrorPanel, PageHeader, TableSkeleton } from '@gntik-ai/blocks'
import type { Workspace } from '@in-falcone/console-api/clients'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import { readSecretName, type WorkspaceSecret } from './consoleWorkspaceSecrets/api'
import { classify, describeSecretError, focusRing, useCopy } from './consoleWorkspaceSecrets/copy'
import { CreateForm } from './consoleWorkspaceSecrets/CreateForm'
import { DeleteConfirm, ReplaceFlow } from './consoleWorkspaceSecrets/Dialogs'
import { needsList, resolveIntent, type Intent } from './consoleWorkspaceSecrets/focus'
import { SecretsTable } from './consoleWorkspaceSecrets/SecretsTable'
import { FailurePanel, Loading, NoAccess, NotFound, RecoveryButton } from './consoleWorkspaceSecrets/States'
import { LocalizedToaster } from './consoleWorkspaceSecrets/Toaster'
import { useWorkspaceSecrets, type Outcome } from './consoleWorkspaceSecrets/useWorkspaceSecrets'
import './consoleWorkspaceSecrets/page.css'

const isProduction = (environment: string | null) => environment === 'production' || environment === 'prod'

interface Shown { workspaceId: string; label: string; environment: string | null; line: string }

function Header({ shown }: { shown: Shown | null }) {
  const { t } = useCopy()
  const environment = shown?.environment ?? null
  const production = isProduction(environment)
  const meta = [{ label: t('activeWorkspace'), value: shown?.line || t('activeWorkspace'), icon: undefined, mono: false },
    ...(environment ? [{ label: t('environmentLabel'), value: <Badge tone={production ? 'warning' : 'neutral'} variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="" data-testid="workspace-secrets-stage-badge" className="max-w-full shrink-0">{production ? t('environmentProduction') : t('environmentOther', { environment })}</Badge>, icon: undefined, mono: false }] : [])]
  const breadcrumbs = shown ? [{ label: t('breadcrumbs.workspaces'), href: '/console/workspaces' }, { label: shown.label, href: `/console/workspaces/${encodeURIComponent(shown.workspaceId)}` }, { label: t('breadcrumbs.secrets') }] : []
  return <PageHeader as="div" wrapTitle={true} titleRef={undefined} tab="" defaultTab="" onTabChange={undefined} title={t('title')} description={t('description')} breadcrumbs={breadcrumbs} status="workspace-secrets" statuses={{ 'workspace-secrets': { label: t('badge'), tone: 'neutral' } }} meta={meta} tabs={null} actions={[]}
    labels={{ title: t('title'), description: t('description'), moreActions: t('actions'), sections: t('actions') }} />
}

// One attempt per request: the focus intent resolves once its list dependency has settled, so a later
// render never pulls focus back from where the user moved on.
function useFocusIntent(view: { current: { rows: readonly WorkspaceSecret[]; busy: boolean } }, onAbsent: (name: string) => void) {
  const pending = useRef<Intent | null>(null)
  const last = useRef<Intent | null>(null)
  const [, force] = useReducer((count: number) => count + 1, 0)
  const request = useCallback((intent: Intent) => { pending.current = intent; last.current = intent; force() }, [force])
  useLayoutEffect(() => {
    const intent = pending.current
    if (!intent || (needsList(intent) && view.current.busy)) return
    pending.current = null
    const target = resolveIntent(intent, view.current.rows)
    if (intent.kind === 'replace-success' && !view.current.rows.some((row) => readSecretName(row) === intent.name)) onAbsent(intent.name)
    target?.focus()
  })
  // Dialogs return focus here when they finish closing.
  const final = useCallback((): HTMLElement | boolean => (last.current && resolveIntent(last.current, view.current.rows)) ?? true, [view])
  return { request, final }
}
function Surface({ workspace, shown }: { workspace: string; shown: Shown }) {
  const { t, i18n: language } = useCopy()
  const announce = useAnnounce()
  const toast = useToast()
  const view = useRef<{ rows: readonly WorkspaceSecret[]; busy: boolean }>({ rows: [], busy: true })
  const notify = useCallback((outcome: Outcome, name: string) => {
    // Successes are announced politely and shown as a toast; neither carries a secret value.
    const message = t(outcome === 'created' ? 'create.created' : outcome === 'replaced' ? 'replace.replaced' : 'delete.deleted', { name })
    announce(message, 'polite')
    toast.add({ title: message, tone: 'success', priority: 'low' })
  }, [announce, toast, t])
  const focus = useFocusIntent(view, (name) => announce(t('replace.replacedAbsent', { name }), 'polite'))
  const s = useWorkspaceSecrets(workspace, { notify, focus: focus.request })
  const { list } = s
  view.current = { rows: list.rows, busy: list.status === 'loading' || list.refreshing }
  const production = isProduction(shown.environment)

  // Only reads the user started move focus to their failure state; a first-load failure never does.
  useEffect(() => {
    if (!list.userStarted) return
    if (list.status === 'failed' && list.failure) {
      const kind = classify(list.failure)
      focus.request(kind === 'no-access' || kind === 'not-found' ? { kind: 'state', target: 'list' } : { kind: 'retry', target: 'list' })
    }
  }, [list.status, list.failure, list.userStarted])
  useEffect(() => {
    if (list.userStarted && list.next.failure) focus.request({ kind: 'retry', target: 'next' })
  }, [list.next.failure])

  const onNew = () => { if (s.create.terminal) s.restoreForm(); else focus.request({ kind: 'name' }) }

  if (list.status === 'failed' && list.failure?.status === 501) {
    return <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="console-workspace-secrets min-w-0 space-y-6 wrap-anywhere" data-testid="workspace-secrets-backend-disabled"
      header={<Header shown={shown} />}>
      <EmptyState icon={undefined} title={t('blocked.title')} description={t('blocked.description')} titleAs="h2" bordered={false} size="md" secondaryAction={null} primaryAction={null} className="min-w-0" />
    </Page>
  }

  const terminalAction = (label: string, onClick: () => void) => <RecoveryButton onClick={onClick}>{label}</RecoveryButton>
  const createArea = s.create.terminal
    ? s.create.terminal.kind === 'no-access'
      ? <NoAccess target="create" title={t('noAccess.create')} failure={s.create.terminal.failure} action={terminalAction(t('noAccess.backToForm'), s.restoreForm)} />
      : <NotFound target="create" title={t('notFound.create')} failure={s.create.terminal.failure} action={terminalAction(t('noAccess.backToForm'), s.restoreForm)} />
    : <CreateForm draft={s.draft} validation={s.validation} pending={s.create.pending} failure={s.create.failure} success={s.feedback?.placement === 'create' ? t('create.created', { name: s.feedback.name }) : null} onField={s.setField} onSubmit={() => { void s.submitCreate() }} />
  const tableTitle = s.table && t(`${s.table.kind === 'no-access' ? 'noAccess' : 'notFound'}.${s.table.op}`)
  const tableArea = s.table && (s.table.kind === 'no-access'
    ? <NoAccess target="table" title={tableTitle!} failure={s.table.failure} action={terminalAction(t('noAccess.backToList'), s.dismissTable)} />
    : <NotFound target="table" title={tableTitle!} failure={s.table.failure} action={terminalAction(t('noAccess.backToList'), s.dismissTable)} />)
  const tableFeedback = s.feedback?.placement === 'table' && <div aria-live="polite" className="min-w-0"><Alert tone="success" role="status" title={undefined} actions={undefined} icon={undefined} onDismiss={undefined} dismissLabel="" description={t(s.feedback.outcome === 'replaced' ? 'replace.replaced' : 'delete.deleted', { name: s.feedback.name })} data-testid="workspace-secrets-table-feedback" /></div>

  let listArea: JSX.Element
  if (list.status === 'loading') listArea = <Loading />
  else if (list.status === 'failed' && list.failure) {
    const kind = classify(list.failure)
    listArea = kind === 'no-access' ? <NoAccess target="list" context="list" title={t('noAccess.list')} failure={list.failure} />
      : kind === 'not-found' ? <NotFound target="list" context="list" title={t('notFound.list')} failure={list.failure} />
        : <FailurePanel target="list" title={t('listError.title')} message={describeSecretError(t, list.failure, 'list')} failure={list.failure} retry={s.retryList} retrying={false} />
  } else if (list.rows.length === 0) {
    listArea = <div data-secret-state="empty" className="min-w-0" data-testid="workspace-secrets-empty"><EmptyState icon={undefined} title={t('empty.title')} titleAs="h2" bordered={false} size="md" secondaryAction={null} className="min-w-0"
      description={shown.environment ? t('empty.descriptionEnvironment', { workspace: shown.label, environment: shown.environment }) : t('empty.description', { workspace: shown.label })}
      primaryAction={<RecoveryButton onClick={onNew}>{t('empty.action')}</RecoveryButton>} /></div>
  } else listArea = <SecretsTable list={list} workspaceLabel={shown.label} environment={shown.environment} locale={language.language} onReplace={s.openReplace} onDelete={s.openDelete} onLoadMore={s.loadMore} onRetryNext={s.retryNext} />

  return <>
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="console-workspace-secrets min-w-0 space-y-6 wrap-anywhere" data-testid="workspace-secrets-page" header={<Header shown={shown} />}>
      <Toolbar variant="plain" aria-label={t('toolbar.label')} className="flex min-w-0 flex-wrap justify-end gap-2">
        <ToolbarEnd><ToolbarButton variant="primary" size="md" icon={undefined} className={focusRing} onClick={onNew}>{t('toolbar.new')}</ToolbarButton></ToolbarEnd>
      </Toolbar>
      {createArea}
      {tableFeedback}
      {tableArea}
      {listArea}
    </Page>
    <ReplaceFlow state={s.replace} finalFocus={focus.final} onField={s.setReplaceField} onSubmit={s.submitReplaceForm} onClose={s.closeReplace} onConfirm={() => { void s.confirmReplace() }} onCancelConfirm={s.cancelReplaceConfirm} />
    <DeleteConfirm state={s.del} production={production} finalFocus={focus.final} onConfirm={() => { void s.confirmDelete() }} onCancel={s.cancelDelete} />
  </>
}

// Port of the legacy WorkspaceRequiredState: loading, error with Reintentar, the picker, or the create link.
function WorkspaceGate() {
  const { t } = useCopy()
  const context = useConsoleContext()
  const { can } = usePermissions()
  const retried = useRef<typeof context.error>(null)
  if (context.loading) return <section role="status" aria-label={t('workspace.loading')}><Text as="p" variant="body" tone="default">{t('workspace.loading')}</Text><TableSkeleton rows={2} columns={1} label={t('workspace.loadingDescription')} className="min-w-0" /></section>
  if (context.error && context.error !== retried.current) {
    return <ErrorPanel title={t('workspace.error')} message={t('workspace.errorDescription')} code={context.error.status ?? null} requestId="" details="" secondaryAction={null} titleAs="h2" announce={true} retryLabel={t('errorPanel.retry')} retrying={false} className="min-w-0"
      onRetry={async () => { retried.current = context.error; await context.reloadTenants?.() }}
      labels={{ title: t('workspace.error'), message: t('workspace.errorDescription'), support: t('errorPanel.support'), retry: t('errorPanel.retry'), retrying: t('errorPanel.retrying'), retryingStatus: t('errorPanel.retrying'), requestId: t('errorPanel.requestId'), copyRequestId: t('errorPanel.copyRequestId'), copied: t('errorPanel.copied'), requestIdCopied: t('errorPanel.copied'), details: t('errorPanel.details') }} />
  }
  const action = context.workspaces.length
    ? <Field invalid={false} disabled={false} className="w-full min-w-0"><FieldLabel htmlFor="workspace-secrets-workspace">{t('workspace.label')}</FieldLabel>
      <SimpleSelect id="workspace-secrets-workspace" value="" defaultValue="" placeholder={t('workspace.placeholder')} clearable={false} size="md" className="w-full min-w-0"
        items={context.workspaces.map((item) => ({ value: item.workspaceId, label: item.displayName }))} onValueChange={(value) => { if (value) context.selectWorkspace(value) }} /></Field>
    : can('tenant.workspaces.create')
      // A plain root-relative anchor: the shell link provider resolves /console/workspaces outside /next.
      ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t('workspace.create')}</Link>
      : <Text as="p" variant="body" tone="muted">{t('workspace.denied')}</Text>
  return <EmptyState icon={undefined} title={t('workspace.title')} description={t('workspace.description')} titleAs="h2" bordered={false} size="md" secondaryAction={null} className="min-w-0" primaryAction={action} />
}

export default function ConsoleWorkspaceSecretsPage() {
  const { t, i18n: language } = useCopy()
  const context = useConsoleContext()
  const id = context.activeWorkspaceId
  const workspace: Workspace | undefined = context.workspaces.find((item) => item.workspaceId === id)
  const tenant = context.tenants.find((item) => item.tenantId === context.activeTenantId)
  const shown: Shown | null = id ? { workspaceId: id, label: workspace?.displayName ?? id, environment: workspace?.environment ?? null, line: [tenant?.displayName, workspace?.displayName].filter(Boolean).join(' · ') } : null
  return <I18nProvider locale={language.language} messages={{ 'common.close': t('close'), 'common.cancel': t('confirm.cancel'), 'breadcrumbs.label': t('breadcrumbs.nav') }}><LiveAnnouncer><ToastProvider timeout={5000} limit={3} toastManager={undefined}>
    {shown
      ? <Surface key={shown.workspaceId} workspace={shown.workspaceId} shown={shown} />
      : <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('actions')} className="console-workspace-secrets min-w-0 space-y-6 wrap-anywhere" data-testid="workspace-secrets-page" header={<Header shown={null} />}><WorkspaceGate /></Page>}
    <LocalizedToaster />
  </ToastProvider></LiveAnnouncer></I18nProvider>
}
