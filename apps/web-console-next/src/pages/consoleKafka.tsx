import { useCallback, useMemo, useState } from 'react'
import { Badge, EmptyState, Field, FieldLabel, I18nProvider, Link, Page, SimpleSelect, Tabs, TabsList, TabsPanel, TabsTab } from '@gntik-ai/ui'
import { KpiRow, PageHeader, PageSkeleton, PageToolbar } from '@gntik-ai/blocks'
import { useConsoleContext } from '../shell/context'
import { usePermissions } from '../shell/permissions'
import * as api from './consoleKafka/api'
import { focusRing, useCopy, useFormat } from './consoleKafka/copy'
import { useSection } from './consoleKafka/hooks'
import { Action, Empty, FailurePanel, Grid, Heading, Muted, Section, Status } from './consoleKafka/parts'
import { Access, Detail, Metadata } from './consoleKafka/views'
import { Publish, Stream, initialPublishForm, type PublishFields } from './consoleKafka/tools'
import type { KafkaInventory, KafkaTopicInventoryItem, KafkaQuotaStatus } from './consoleKafka/types'

function Header({ inventory }: { inventory?: KafkaInventory | null }) {
  const { t } = useCopy(), { formatEnumLabel } = useFormat()
  return <PageHeader as="div" wrapTitle={true} title={t('kafkaEvents')} description={t('topicsAclsOperationalMetadataBridgesAndPublishStreamToolsForTheActiveWorkspace')} breadcrumbs={[]} status="" statuses={{}} meta={inventory ? [{ label: t('broker'), value: formatEnumLabel(inventory.brokerMode) }, { label: t('isolation'), value: formatEnumLabel(inventory.isolationMode) }] : []} tabs={null} actions={[]} labels={{ title: t('kafkaEvents'), description: '', moreActions: t('kafkaEvents'), sections: t('kafkaEvents') }} />
}
function Quota({ quota }: { quota?: KafkaQuotaStatus }) {
  const { t } = useCopy(), { quotaLabel } = useFormat(), label = quotaLabel(quota)
  return label ? <Badge tone="warning" variant="soft" size="sm" shape="rounded" dot={false} onRemove={undefined} removeLabel="">{label}</Badge> : t('missingValueLabel')
}
function WorkspaceGate() {
  const { t } = useCopy(), context = useConsoleContext(), { can } = usePermissions()
  if (context.loading) return <PageSkeleton stats={0} rows={3} label={t('loadingWorkspaces')} className="min-w-0" />
  if (!context.activeTenantId) return <Empty title={t('selectAnOrganizationToContinue')} />
  if (context.error) return <FailurePanel error={context.error} title={t('couldNotLoadWorkspaces')} noAccess={t('errors.forbidden')} retry={() => context.reloadWorkspaces?.()} />
  const action = context.workspaces.length ? <Field invalid={false} disabled={false} className="min-w-0"><FieldLabel htmlFor="kafka-workspace">{t('chooseWorkspace')}</FieldLabel><SimpleSelect id="kafka-workspace" value="" defaultValue="" placeholder={t('selectAWorkspace')} clearable={false} size="md" disabled={false} items={context.workspaces.map((workspace) => ({ value: workspace.workspaceId, label: workspace.displayName }))} onValueChange={(id) => { if (id) context.selectWorkspace(id) }} className={`w-full min-w-0 ${focusRing}`} /></Field>
    : can('tenant.workspaces.create') ? <Link href="/console/workspaces" tone="primary" underline="always" external={false} externalLabel="" className={focusRing}>{t('createWorkspace')}</Link> : <Muted>{t('thisOrganizationHasNoWorkspacesYetAskAnOrganizationOrWorkspaceOwnerOrAdministratorToCreateTheFirstOne')}</Muted>
  return <EmptyState icon={undefined} title={t('selectAWorkspace')} description={t('selectAWorkspaceToViewKafkaResources')} titleAs="h2" bordered={false} size="md" primaryAction={action} secondaryAction={null} className="min-w-0" />
}
function Bridges({ workspaceId, bridgeIds }: { workspaceId: string; bridgeIds: string[] }) {
  const { t } = useCopy(), { formatValue } = useFormat()
  const cache = useMemo(() => new Map<string, Awaited<ReturnType<typeof api.bridge>>>(), [workspaceId, bridgeIds])
  const load = useCallback(async (signal: AbortSignal) => {
    // Match the legacy bridge order. Successful reads are retained so retry only refetches the failed endpoint.
    for (const bridgeId of bridgeIds) {
      if (!cache.has(bridgeId)) { const bridge = await api.bridge(workspaceId, bridgeId, signal); if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); cache.set(bridgeId, bridge) }
    }
    return bridgeIds.map((id) => cache.get(id)!)
  }, [workspaceId, bridgeIds, cache]), state = useSection(load)
  return <Section state={state} title={t('couldNotLoadTheBridgeList')} loading={t('loadingBridges')} noAccess={t('youDoNotHaveAccessToBridges')}>
    {(data) => <Grid rows={data} id={(row) => row.bridgeId} label={t('bridges')} columns={[
      { id: 'source', header: t('source'), cell: (row) => `${formatValue(row.source?.sourceType)} ${row.source?.sourceRef ? `· ${row.source.sourceRef}` : ''}` }, { id: 'target', header: t('targetTopic'), cell: (row) => row.topicRef },
      { id: 'status', header: t('status'), cell: (row) => <Status value={row.status} /> }, { id: 'delivery', header: t('delivery'), cell: (row) => formatValue(row.delivery?.mode) }, { id: 'audit', header: t('audit'), cell: (row) => formatValue(row.audit?.enabled ?? row.audit?.mode) },
    ]} />}
  </Section>
}
function Topic({ item, back, tab, setTab, form, setForm }: { item: KafkaTopicInventoryItem; back: () => void; tab: string; setTab: (value: string) => void } & PublishFields) {
  const { t } = useCopy(), { quotaLabel } = useFormat()
  const detailLoad = useCallback((signal: AbortSignal) => api.detail(item.resourceId, signal), [item.resourceId]), detail = useSection(detailLoad)
  const accessLoad = useCallback((signal: AbortSignal) => api.access(item.resourceId, signal), [item.resourceId]), access = useSection(accessLoad)
  const metadataLoad = useCallback((signal: AbortSignal) => api.metadata(item.resourceId, signal), [item.resourceId]), metadata = useSection(metadataLoad)
  return <section className="min-w-0 space-y-4">
    <Heading title={detail.data?.topicName ?? item.topicName ?? t('selectedTopic')} /><div className="flex flex-wrap gap-2"><Status value={detail.data?.provisioning?.state ?? item.provisioning?.state ?? item.status} />{quotaLabel(detail.data?.quotaStatus ?? item.quotaStatus) ? <Quota quota={detail.data?.quotaStatus ?? item.quotaStatus} /> : null}</div>
    <Tabs value={tab} onValueChange={(value) => setTab(String(value))} orientation="horizontal" variant="underline" className="min-w-0">
      <TabsList aria-label={t('topicDetail')} indicator={false} fullWidth={false} activateOnFocus={true} className="max-w-full flex-wrap">{['detail', 'access', 'metadata', 'publish', 'stream'].map((value) => <TabsTab key={value} value={value} icon={undefined} count={undefined} className={focusRing}>{t(`tabs.${value}`)}</TabsTab>)}</TabsList>
      <TabsPanel value="detail" className="min-w-0 pt-4"><Section state={detail} title={t('couldNotLoadTheTopicDetail')} loading={t('loadingDetail')} noAccess={t('youDoNotHaveAccessToTheTopicDetail')} back={back}>{(data) => <Detail data={data} />}</Section></TabsPanel>
      <TabsPanel value="access" className="min-w-0 pt-4"><Section state={access} title={t('couldNotLoadTheTopicAccessPolicy')} loading={t('loadingAccessPolicy')} noAccess={t('youDoNotHaveAccessToTheTopicAccessPolicy')} back={back}>{(data) => <Access data={data} />}</Section></TabsPanel>
      <TabsPanel value="metadata" className="min-w-0 pt-4"><Section state={metadata} title={t('couldNotLoadTheTopicOperationalMetadata')} loading={t('loadingOperationalMetadata')} noAccess={t('youDoNotHaveAccessToTheTopicOperationalMetadata')} back={back}>{(data) => <Metadata data={data} />}</Section></TabsPanel>
      <TabsPanel keepMounted={true} value="publish" className="min-w-0 pt-4"><Publish resourceId={item.resourceId} form={form} setForm={setForm} /></TabsPanel>
      <TabsPanel keepMounted={true} value="stream" className="min-w-0 pt-4"><Stream resourceId={item.resourceId} /></TabsPanel>
    </Tabs>
  </section>
}
function Inventory({ data, selected, select }: { data: KafkaInventory; selected: string | null; select: (id: string) => void }) {
  const { t } = useCopy(), { formatValue, formatCleanupPolicy } = useFormat()
  return data.items.length ? <Grid rows={data.items} id={(item) => item.resourceId} label={t('kafkaTopics')} columns={[
    { id: 'name', header: t('name'), cell: (item) => <div><Action aria-pressed={selected === item.resourceId} onClick={() => select(item.resourceId)}>{item.topicName}</Action><Muted>{item.physicalTopicName || item.resourceId}</Muted></div> },
    { id: 'status', header: t('status'), cell: (item) => <Status value={item.provisioning?.state ?? item.status} /> }, { id: 'policy', header: t('policy'), cell: (item) => formatCleanupPolicy(item.cleanupPolicy) },
    { id: 'partitions', header: t('partitions'), cell: (item) => formatValue(item.partitionCount) }, { id: 'retention', header: t('retentionH'), cell: (item) => formatValue(item.retentionHours) }, { id: 'quota', header: t('quota'), cell: (item) => <Quota quota={item.quotaStatus} /> },
  ]} /> : <Empty title={t('thereAreNoTopicsInThisWorkspace')} />
}
function Content({ workspaceId, form, setForm }: { workspaceId: string } & PublishFields) {
  const { t } = useCopy(), [selection, setSelection] = useState<KafkaTopicInventoryItem | null>(null), [tab, setTab] = useState('detail')
  const selected = selection?.resourceId ?? null
  const load = useCallback((signal: AbortSignal) => api.inventory(workspaceId, signal), [workspaceId]), state = useSection(load), data = state.data
  const bridgeIds = useMemo(() => [...new Set([...(data?.bridgeIds ?? []), ...(data?.items.flatMap((item) => item.operationalMetadata?.bridgeIds ?? []) ?? [])])], [data])
  const missingIds = !bridgeIds.length && data?.items.some((item) => (item.operationalMetadata?.bridgeCount ?? 0) > 0)
  const item = data?.items.find((row) => row.resourceId === selected) ?? selection
  function select(id: string | null) { setTab('detail'); setSelection(id ? data?.items.find((row) => row.resourceId === id) ?? selection : null) }
  return <>
    <Header inventory={data} />
    {state.loading && !state.error ? <PageSkeleton stats={4} rows={0} label={t('loadingInventory')} className="min-w-0" /> : <KpiRow items={[
      { id: 'total', label: t('total'), value: String(data?.counts?.total ?? data?.counts?.topics ?? data?.items.length ?? 0), delta: undefined, trend: undefined, trendTone: undefined },
      ...(['active', 'provisioning', 'degraded'] as const).map((id) => ({ id, label: t(`counts.${id}`), value: String(data?.counts?.[id] ?? 0), delta: undefined, trend: undefined, trendTone: undefined })),
    ]} variant="strip" showTrends={false} label={t('kafkaTopics')} className="min-w-0" containerClassName="min-w-0" />}
    <div className="grid min-w-0 gap-6 xl:grid-cols-2"><div className="min-w-0 space-y-6"><section className="min-w-0 space-y-4"><Heading title={t('kafkaTopics')} />
      <div hidden={true}><PageToolbar search="" defaultSearch="" onSearchChange={undefined} searchLabel="" searchPlaceholder="" filters={null} views={[]} view="" defaultView="" onViewChange={undefined} primaryAction={null} aria-label={t('kafkaTopics')} className="min-w-0" /></div>
      <Section state={state} title={t('couldNotLoadTheKafkaInventory')} loading={t('loadingInventory')} noAccess={t('youDoNotHaveAccessToTheKafkaInventory')}>{(inventory) => <Inventory data={inventory} selected={selected} select={select} />}</Section>
    </section><section className="min-w-0 space-y-4"><Heading title={t('bridges')} />{bridgeIds.length ? <Bridges workspaceId={workspaceId} bridgeIds={bridgeIds} /> : state.loading ? <PageSkeleton stats={0} rows={2} label={t('loadingBridges')} className="min-w-0" /> : <Empty title={t(missingIds ? 'theBridgeListRequiresIdsExposedByTheInventory' : 'thereAreNoBridgesConfiguredInThisWorkspace')} />}</section></div>
    {item ? <Topic key={item.resourceId} item={item} back={() => select(null)} tab={tab} setTab={setTab} form={form} setForm={setForm} /> : <section className="min-w-0 space-y-3"><Heading title={t('topicDetail')} /><Empty title={t('selectATopicFromTheInventoryToReviewDetailAccessMetadataPublishEventsOrOpenAnSseStream')} /></section>}
    </div>
  </>
}
export default function ConsoleKafkaPage() {
  const { t, i18n } = useCopy(), context = useConsoleContext(), [form, setForm] = useState(initialPublishForm)
  return <I18nProvider locale={i18n.language} messages={{ 'common.close': t('close'), 'common.cancel': t('cancel'), 'common.copy': t('copy'), 'common.copied': t('copied'), 'common.copyFailed': t('couldNotCopy'), 'common.loading': t('loadingInventory') }}>
    <Page width="wide" title={null} description={null} actions={null} actionBar={null} actionBarLabel={t('kafkaEvents')} className="min-w-0 space-y-6 wrap-anywhere" data-testid="console-kafka-page" header={context.activeTenantId && context.activeWorkspaceId ? null : <Header />}>
      {context.activeTenantId && context.activeWorkspaceId ? <Content key={`${context.activeTenantId}/${context.activeWorkspaceId}`} workspaceId={context.activeWorkspaceId} form={form} setForm={setForm} /> : <WorkspaceGate />}
    </Page>
  </I18nProvider>
}
