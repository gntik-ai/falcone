import { useCallback, useMemo, useState } from 'react'
import { Badge, CodeBlock, CopyButton, Skeleton, Tabs, TabsList, TabsPanel, TabsTab, Text } from '@gntik-ai/ui'
import { KpiRow, SectionHeader, type DataTableColumn } from '@gntik-ai/blocks'
import { loadRealmSection, type Failure, type IamClient, type IamScope, type RealmSection } from './api'
import { Action, Empty, Grid, Loading, SectionFailure, focusRing, useCopy, useLoad } from './ui'

type Result<T> = { data?: { items?: T[]; compatibility?: { provider: string; contractVersion: string } }; failure?: Failure } | null
const sections: RealmSection[] = ['users', 'roles', 'scopes', 'clients']

function Flag({ label, value }: { label: string; value: boolean }) {
  const { t } = useCopy()
  return <Badge tone={value ? 'success' : 'neutral'} variant={value ? 'soft' : 'outline'} size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{t('labelValue', { label, value: t(value ? 'yes' : 'no') })}</Badge>
}
function Chip({ children, tone = 'neutral' }: { children: string; tone?: 'neutral' | 'success' }) {
  return <Badge tone={tone} variant="outline" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{children}</Badge>
}
const list = (values?: string[]) => values && values.length ? values.join(', ') : '—'

export function Realm({ realmId, workspaceId, workspaceLabel }: { realmId: string; workspaceId: string | null; workspaceLabel: string | null }) {
  const { t } = useCopy()
  const [revisions, setRevisions] = useState<Record<RealmSection, number>>({ users: 0, roles: 0, scopes: 0, clients: 0 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const retry = (section: RealmSection) => setRevisions((current) => ({ ...current, [section]: current[section] + 1 }))
  const loaders = {
    users: useCallback((signal: AbortSignal) => loadRealmSection(realmId, 'users', signal), [realmId]),
    roles: useCallback((signal: AbortSignal) => loadRealmSection(realmId, 'roles', signal), [realmId]),
    scopes: useCallback((signal: AbortSignal) => loadRealmSection(realmId, 'scopes', signal), [realmId]),
    clients: useCallback((signal: AbortSignal) => loadRealmSection(realmId, 'clients', signal), [realmId]),
  }
  const results = {
    users: useLoad(loaders.users, revisions.users) as Result<unknown>, roles: useLoad(loaders.roles, revisions.roles) as Result<unknown>,
    scopes: useLoad(loaders.scopes, revisions.scopes) as Result<IamScope>, clients: useLoad(loaders.clients, revisions.clients) as Result<IamClient>,
  }
  const compatibility = sections.map((section) => results[section]?.data?.compatibility).find(Boolean)
  const scopes = results.scopes?.data?.items ?? [], clients = results.clients?.data?.items ?? []
  const selected = clients.find((client) => client.clientId === selectedId) ?? clients[0] ?? null
  const label = (section: RealmSection) => t(`sections.${section}`)
  const failure = (section: RealmSection) => results[section]?.failure
  const failed = (section: RealmSection) => Boolean(failure(section))
  const value = (section: RealmSection) => (failed(section) ? '—' : String(results[section]?.data?.items?.length ?? 0))

  const scopeColumns: DataTableColumn<IamScope>[] = [
    { id: 'scope', header: t('scopes.scope'), sortable: false, cell: (scope) => scope.scopeName },
    { id: 'protocol', header: t('scopes.protocol'), sortable: false, cell: (scope) => <Chip>{t(`enums.${scope.protocol}`, { defaultValue: scope.protocol })}</Chip> },
    { id: 'options', header: t('scopes.options'), sortable: false, cell: (scope) => <div className="flex flex-wrap gap-2"><Flag label={t('scopes.default')} value={scope.isDefault} /><Flag label={t('scopes.optional')} value={scope.isOptional} /><Flag label={t('scopes.token')} value={scope.includeInTokenScope} /></div> },
    { id: 'clients', header: t('scopes.clients'), sortable: false, cell: (scope) => list(scope.assignedClientIds) },
  ]
  const clientColumns: DataTableColumn<IamClient>[] = [
    { id: 'client', header: t('clients.client'), sortable: false, cell: (client) => <Action aria-pressed={selected?.clientId === client.clientId} onClick={() => setSelectedId(client.clientId)}>{client.clientId}</Action> },
    { id: 'protocol', header: t('clients.protocol'), sortable: false, cell: (client) => <Chip>{t(`enums.${client.protocol}`, { defaultValue: client.protocol })}</Chip> },
    { id: 'access', header: t('clients.access'), sortable: false, cell: (client) => t(`enums.${client.accessType}`, { defaultValue: client.accessType }) },
    { id: 'state', header: t('clients.state'), sortable: false, cell: (client) => <div className="flex flex-wrap gap-2"><Flag label={t('clients.enabled')} value={client.enabled} /><Chip>{t(`enums.${client.state}`, { defaultValue: client.state })}</Chip></div> },
    { id: 'redirects', header: t('clients.redirects'), sortable: false, cell: (client) => list(client.redirectUris) },
    { id: 'scopes', header: t('clients.scopes'), sortable: false, cell: (client) => <div><div>{t('labelValue', { label: t('clients.defaults'), value: list(client.defaultScopes) })}</div><div>{t('labelValue', { label: t('clients.optionals'), value: list(client.optionalScopes) })}</div></div> },
  ]

  return <section aria-labelledby="auth-realm-heading" className="min-w-0 space-y-6">
    <SectionHeader title={t('realm.title')} description={t('realm.description')} count={undefined} actions={[]} as="h2" bordered={false} headingId="auth-realm-heading" className="min-w-0" />
    {compatibility && <div><Chip>{`${compatibility.provider} · ${compatibility.contractVersion}`}</Chip></div>}
    <div role="group" aria-label={t('kpi.label')} aria-busy={sections.some((section) => !results[section])} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {sections.map((section) => results[section]
        ? <KpiRow key={section} label={label(section)} variant="cards" showTrends={false} className="min-w-0 sm:grid-cols-1"
          items={[{ id: section, label: t(`kpi.${section}`), value: value(section), delta: undefined, trend: undefined, trendTone: undefined }]} />
        : <div key={section} role="status" aria-label={t('kpi.loadingNamed', { label: t(`kpi.${section}`) })} aria-busy={true} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
          <Text as="span" variant="body" tone="muted">{t(`kpi.${section}`)}</Text>
          <Skeleton shape="block" className="h-7 w-16" />
        </div>)}
    </div>
    {(['users', 'roles'] as const).filter(failed).map((section) => <SectionFailure key={section} kind="realm" section={label(section)} testId={`auth-section-${section}-error`} failure={failure(section)!} onRetry={() => retry(section)} backHref="/console/overview" />)}
    <div className="grid min-w-0 gap-6 xl:grid-cols-2">
      <section aria-label={t('scopes.title')} className="min-w-0 space-y-4">
        <SectionHeader title={t('scopes.title')} description={t('scopes.description')} count={undefined} actions={[]} as="h3" bordered={false} headingId={undefined} className="min-w-0" />
        {!results.scopes ? <Loading label={t('scopes.loading')} /> : failed('scopes') ? <SectionFailure kind="realm" section={label('scopes')} testId="auth-section-scopes-error" failure={failure('scopes')!} onRetry={() => retry('scopes')} backHref="/console/overview" />
          : scopes.length ? <Grid rows={scopes} columns={scopeColumns} id={(scope) => scope.scopeName} label={t('scopes.table')} empty={t('scopes.empty')} /> : <Empty title={t('scopes.empty')} testId="auth-scopes-empty" />}
      </section>
      <section aria-label={t('clients.title')} className="min-w-0 space-y-4">
        <SectionHeader title={t('clients.title')} description={t('clients.description')} count={undefined} actions={[]} as="h3" bordered={false} headingId={undefined} className="min-w-0" />
        {!results.clients ? <Loading label={t('clients.loading')} columns={6} /> : failed('clients') ? <SectionFailure kind="realm" section={label('clients')} testId="auth-section-clients-error" failure={failure('clients')!} onRetry={() => retry('clients')} backHref="/console/overview" />
          : clients.length ? <Grid rows={clients} columns={clientColumns} id={(client) => client.clientId} label={t('clients.table')} empty={t('clients.empty')} /> : <Empty title={t('clients.empty')} testId="auth-clients-empty" />}
        {!failed('clients') && selected && <Snippets client={selected} realmId={realmId} workspaceId={workspaceId} workspaceLabel={workspaceLabel} />}
      </section>
    </div>
  </section>
}

// Mirrors the legacy iam-client snippet entry. Only placeholders appear: no secret is ever fetched.
function Snippets({ client, realmId, workspaceId, workspaceLabel }: { client: IamClient; realmId: string; workspaceId: string | null; workspaceLabel: string | null }) {
  const { t } = useCopy()
  const code = useMemo(() => `curl -X POST '/realms/${realmId}/protocol/openid-connect/token' \\\n  -H 'content-type: application/x-www-form-urlencoded' \\\n  --data-urlencode 'grant_type=client_credentials' \\\n  --data-urlencode 'client_id=${client.clientId}' \\\n  --data-urlencode 'client_secret=<CLIENT_SECRET>'`, [client.clientId, realmId])
  const warning = ['provisioning', 'pending', 'error', 'degraded', 'failed'].includes(client.state.toLowerCase())
  const notes = [t('snippets.tokenNote'), ...(client.enabled ? [] : [t('snippets.disabledNote')]), ...(warning ? [t('snippets.stateNote', { state: client.state })] : [])]
  return <section aria-labelledby="auth-snippets-heading" className="min-w-0 space-y-3">
    <SectionHeader title={t('snippets.title')} description={t('snippets.description', { client: client.clientId, workspace: workspaceLabel ?? workspaceId ?? t('snippets.noWorkspace') })} count={undefined} actions={[]} as="h3" bordered={false} headingId="auth-snippets-heading" className="min-w-0" />
    <Tabs defaultValue="curl">
      <TabsList aria-label={t('snippets.tabs')} className="max-w-full overflow-x-auto"><TabsTab value="curl">{t('snippets.curl')}</TabsTab></TabsList>
      <TabsPanel value="curl" tabIndex={-1} className="min-w-0 space-y-3">
        <CopyButton value={code} display="label" label={t('snippets.copy')} copiedLabel={t('snippets.copied')} announcement={t('snippets.copiedAnnouncement')} failureLabel={t('snippets.copyFailed')} failureAnnouncement={t('snippets.copyFailed')} variant="secondary" size="md" className={focusRing} />
        <CodeBlock code={code} language="bash" filename="" label={t('snippets.curl')} showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={undefined} highlight={undefined} className="min-w-0 max-w-full" />
        <ul className="list-disc space-y-1 pl-5">{notes.map((note) => <li key={note}><Text as="span" variant="body" tone="muted">{note}</Text></li>)}</ul>
        <Text as="p" variant="body" tone="muted"><span className="font-medium">{t('snippets.secrets')}</span> {t('snippets.secretRef')}</Text>
      </TabsPanel>
    </Tabs>
  </section>
}
