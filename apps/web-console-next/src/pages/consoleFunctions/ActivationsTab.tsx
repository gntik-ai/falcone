import { CodeBlock, Text } from '@gntik-ai/ui'
import { DataTable, DescriptionListCard, InlineCallout, LogViewer, SectionHeader, type DataTableColumn, type DescriptionItem } from '@gntik-ai/blocks'
import type { Failure, FunctionActivation } from './api'
import { describeActivationFailure, formatValue, useCopy } from './copy'
import { Json } from './DetailTab'
import { Empty, FailurePanel, FunctionStatus, Loading } from './States'
import type { ActivationPart, Fn, Sect } from './useFunctions'

const retryable = (failure: Failure) => failure.status !== 403 && failure.status !== 404

function PartFailure({ s, part, section }: { s: Fn; part: ActivationPart; section: 'activation' | 'logs' | 'result' }) {
  const { t } = useCopy()
  const state = (section === 'activation' ? s.activation : section === 'logs' ? s.logs : s.result) as Sect<unknown>
  if (!state.failure) return null
  return <FailurePanel section={section} failure={state.failure} message={describeActivationFailure(t, state.failure, section)} retry={() => s.retryPart(part)} retrying={state.phase === 'loading'} canRetry={retryable(state.failure)} />
}

function Metadata({ s }: { s: Fn }) {
  const { t } = useCopy()
  const { activation } = s
  if (activation.failure) return <PartFailure s={s} part="activation" section="activation" />
  if (activation.phase !== 'ok' || !activation.data) return activation.phase === 'ok' ? null : <Loading label={t('activations.detailLoading')} rows={3} columns={2} />
  const a = activation.data
  const field = (id: string, label: string, value: unknown, mono = false): DescriptionItem => ({ id, label, value: formatValue(t, value), render: undefined, status: undefined, mono, copyable: false, copyValue: undefined })
  const items: DescriptionItem[] = [
    field('activationId', t('activations.activationId'), a.activationId, true),
    field('resourceId', t('activations.resourceId'), a.resourceId, true),
    { id: 'status', label: t('activations.status'), value: undefined, render: <FunctionStatus value={a.status} />, status: undefined, mono: false, copyable: false, copyValue: undefined },
    field('startedAt', t('activations.startedAt'), a.startedAt),
    field('finishedAt', t('activations.finishedAt'), a.finishedAt),
    field('duration', t('activations.durationMsLabel'), a.durationMs),
    field('statusCode', t('activations.statusCode'), a.statusCode),
    field('triggerKind', t('activations.triggerKind'), a.triggerKind),
    field('memory', t('activations.memory'), a.memoryMb),
    field('invocationId', t('activations.invocationId'), a.invocationId, true),
    field('retention', t('activations.retention'), a.policy?.retentionDays),
  ]
  return <DescriptionListCard title={t('activations.detailTitle')} description="" items={items} wrap={true} columns={2} titleAs="h4" onEdit={undefined} onCopy={undefined} editLabel="" className="min-w-0" />
}

function Logs({ s, running }: { s: Fn; running: boolean }) {
  const { t } = useCopy()
  const { logs } = s
  let body
  if (logs.failure) body = <PartFailure s={s} part="logs" section="logs" />
  else if (logs.phase === 'loading') body = <Loading label={t('activations.detailLoading')} rows={2} columns={1} />
  else if (logs.phase === 'ok' && !logs.data) body = running ? <Text as="p" variant="body" tone="muted">{t('activations.logsRunning')}</Text> : null
  else if (logs.data) {
    const lines = logs.data.lines ?? []
    body = <>
      {logs.data.truncated && <InlineCallout tone="warning" title={t('activations.logsTruncated')} labels={{ title: t('activations.logsTruncated') }} description={null} actions={[]} icon={undefined} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" />}
      {lines.length === 0 ? <Text as="p" variant="body" tone="muted">{t('activations.logsEmpty')}</Text>
        : <div data-testid="functions-activation-logs" className="min-w-0"><LogViewer title={t('activations.logsLabel')} titleAs="h4" height={288} rowHeight={24} wrap={true} overscan={8} defaultLevels={['debug', 'info', 'warn', 'error']} defaultFollow={false} announceLines={false}
          onCopyLine={undefined} onSelectLine={undefined} selectedLineId={undefined} className="min-w-0"
          lines={lines.map((message, index) => ({ id: String(index), timestamp: String(index + 1), level: 'info' as const, message, source: undefined }))}
          labels={{ title: t('activations.logsLabel'), levelFilter: t('log.levelFilter'), searchLabel: t('log.search'), searchPlaceholder: t('log.searchPlaceholder'), follow: t('log.follow'), empty: t('log.empty'), copied: t('log.copied'),
            levels: { debug: t('log.debug'), info: t('log.info'), warn: t('log.warn'), error: t('log.error') },
            count: (visible: number, total: number) => visible === total ? t('log.countAll', { total }) : t('log.countFiltered', { visible, total }),
            inspect: (timestamp: string) => t('log.inspect', { timestamp }), copy: (timestamp: string) => t('log.copy', { timestamp }) }} /></div>}
    </>
  }
  return <section aria-label={t('activations.logsTitle')} className="min-w-0 space-y-2">
    <SectionHeader title={t('activations.logsTitle')} description={null} count={undefined} actions={[]} as="h3" bordered={false} headingId={undefined} className="min-w-0" />
    {body}
  </section>
}

function ResultBody({ s, running }: { s: Fn; running: boolean }) {
  const { t } = useCopy()
  const { result } = s
  if (result.failure) return <PartFailure s={s} part="result" section="result" />
  if (result.phase === 'loading') return <Loading label={t('activations.detailLoading')} rows={2} columns={1} />
  if (result.phase !== 'ok') return null
  const res = result.data
  if (!res) return <Text as="p" variant="body" tone="muted">{t(running ? 'activations.resultRunning' : 'activations.resultNone')}</Text>
  if ((res.contentType ?? '').includes('octet-stream')) return <Text as="p" variant="body" tone="muted">{t('activations.resultBinary')}</Text>
  if (res.result === null || res.result === undefined) return <Text as="p" variant="body" tone="muted">{t('activations.resultNone')}</Text>
  const label = t('activations.resultLabel')
  if (typeof res.result === 'object') return <div data-testid="functions-activation-result" className="min-w-0"><Json value={res.result} label={label} /></div>
  const code = typeof res.result === 'string' ? res.result : JSON.stringify(res.result, null, 2)
  return <div data-testid="functions-activation-result" className="min-w-0"><CodeBlock code={code} language="text" filename="" showLineNumbers={false} highlightLines={[]} defaultWrap={true} wrapToggle={false} copyable={false} maxHeight={288} highlight={undefined} label={label} className="min-w-0" /></div>
}

export function ActivationsTab({ s }: { s: Fn }) {
  const { t } = useCopy()
  const { activations } = s
  const items = activations.data?.items ?? []
  const columns: DataTableColumn<FunctionActivation>[] = [
    { id: 'status', header: t('activations.status'), sortable: false, hideable: false, cell: (row) => <FunctionStatus value={row.status} /> },
    { id: 'activationId', header: t('activations.activationId'), sortable: false, variant: 'mono', cell: (row) => <span className="block max-w-40 break-all whitespace-normal">{row.activationId}</span> },
    { id: 'duration', header: t('activations.duration'), sortable: false, cell: (row) => <span className="block whitespace-normal">{`${t('activations.durationMs', { ms: row.durationMs })} · ${row.triggerKind}`}</span> },
    { id: 'startedAt', header: t('activations.startedAt'), sortable: false, className: 'text-muted-foreground', cell: (row) => <span className="block whitespace-normal break-words">{formatValue(t, row.startedAt)}</span> },
  ]
  let list
  if (activations.failure) list = <FailurePanel section="activations" failure={activations.failure} retry={s.retryActivations} retrying={activations.phase === 'loading'} />
  else if (activations.phase !== 'ok') list = <Loading label={t('activations.loading')} rows={3} columns={3} />
  else if (items.length === 0) list = <Empty title={t('activations.empty')} testId="functions-activations-empty" />
  else list = <DataTable rows={items} columns={columns} getRowId={(row) => row.activationId} getRowLabel={(row) => row.activationId} caption={t('activations.caption')} showCaption={false} paginated={false}
    selectionMode="single" selectionName="functions-activation" aria-label={t('activations.caption')} selectedId={s.activationId} onSelectedIdChange={s.openActivation} isRowDisabled={() => false}
    rowActions={undefined} toolbar={null} sort={null} defaultSort={null} manualSorting={true} loading={false} loadingRows={0} emptyState={null} showDensityToggle={false} showColumnMenu={false} showViewSwitcher={false}
    views={[]} defaultViews={[]} hiddenColumns={[]} resizable={false} virtualize={false} groupBy={undefined} showPinMenu={false} className="min-w-0"
    labels={{ scrollRegion: t('activations.caption'), selection: t('activations.selection'), selectRow: (label: string) => label, emptyTitle: t('activations.empty'), emptyDescription: t('activations.empty'), loading: () => t('activations.loading') }} />
  const running = s.activation.data?.status === 'running'
  return <div className="grid min-w-0 gap-6 xl:grid-cols-2" data-testid="functions-activations">
    <section aria-label={t('activations.title')} className="min-w-0 space-y-3">
      <SectionHeader title={t('activations.title')} description={null} count={undefined} actions={[]} as="h3" bordered={false} headingId={undefined} className="min-w-0" />
      {list}
    </section>
    <section aria-label={t('activations.detailTitle')} className="min-w-0 space-y-4" data-testid="functions-activation-detail">
      {!s.activationId ? <Text as="p" variant="body" tone="muted">{t('activations.select')}</Text> : <>
        <Metadata s={s} />
        <Logs s={s} running={running} />
        <section aria-label={t('activations.resultTitle')} className="min-w-0 space-y-2">
          <SectionHeader title={t('activations.resultTitle')} description={null} count={undefined} actions={[]} as="h3" bordered={false} headingId={undefined} className="min-w-0" />
          <ResultBody s={s} running={running} />
        </section>
      </>}
    </section>
  </div>
}
