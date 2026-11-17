import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { CanvasLayout, EmptyState, I18nProvider, LiveAnnouncer, StatusDot, StatusTag, Text, ToastProvider, useAnnounce } from '@gntik-ai/ui'
import { InlineCallout, PageHeader } from '@gntik-ai/blocks'
import { useConsoleContext } from '../shell/context'
import i18n from '../i18n'
import es from '../locales/es/pages.console-flow-run-page.json'
import en from '../locales/en/pages.console-flow-run-page.json'
import { getExecution, getFlow, isTerminalExecution, type ExecutionDetail, type FlowDefinitionRecord } from './consoleFlowRun/api'
import { Actions, type WaitingApprovalNode } from './consoleFlowRun/Actions'
import { Loading, LoadFailure, WorkspaceGate, runsHref } from './consoleFlowRun/chrome'
import { Inspector, inspectorHeadingId } from './consoleFlowRun/Inspector'
import { LocalizedToaster, failureFrom, type Failure } from './consoleFlowRun/notify'
import { RunCanvas, focusRunNode } from './consoleFlowRun/RunCanvas'
import { mergeStatuses, runStatusTones, staticStatusesFromDetail, type NodeStatusSnapshot } from './consoleFlowRun/status'
import { useFlowRunStream } from './consoleFlowRun/stream'
import './consoleFlowRun/page.css'

i18n.addResourceBundle('es', 'pages.console-flow-run-page', es)
i18n.addResourceBundle('en', 'pages.console-flow-run-page', en)

function RunView({ workspaceId, flowId, executionId }: { workspaceId: string; flowId: string; executionId: string }) {
  const { t } = useTranslation('pages.console-flow-run-page')
  const navigate = useNavigate()
  const announce = useAnnounce()
  const layout = useRef<HTMLDivElement>(null)
  const [record, setRecord] = useState<FlowDefinitionRecord | null>(null)
  const [detail, setDetail] = useState<ExecutionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [focusRequest, setFocusRequest] = useState(0)
  const restoreFocus = useRef<string | null>(null)
  const latestLoad = useRef(0)
  // StrictMode replays the first effect; the replay shares the first request instead of repeating it.
  const firstRequest = useRef<Promise<[FlowDefinitionRecord, ExecutionDetail]> | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const load = useCallback(async (first = false) => {
    const ticket = ++latestLoad.current
    setLoading(true); setFailure(null)
    try {
      const request = () => Promise.all([getFlow(workspaceId, flowId), getExecution(workspaceId, flowId, executionId)])
      const [flow, execution] = await (first ? (firstRequest.current ??= request()) : request())
      if (!mounted.current || ticket !== latestLoad.current) return
      setRecord(flow); setDetail(execution)
    } catch (cause) {
      if (mounted.current && ticket === latestLoad.current) setFailure(failureFrom(cause))
    } finally {
      if (mounted.current && ticket === latestLoad.current) setLoading(false)
    }
  }, [workspaceId, flowId, executionId])
  useEffect(() => { void load(true) }, [load])

  const terminal = isTerminalExecution(detail?.status)
  const stream = useFlowRunStream({
    workspaceId, executionId, enabled: detail !== null && !terminal,
    // One polite announcement per live status change.
    onStatusChange: (nodeId, status) => announce(t('nodeStatusChanged', { node: nodeId, status: t(`nodeStatus.${status}`, { defaultValue: status }) }), 'polite'),
  })
  // When the stream ends the run is terminal: reload the detail for the final static render.
  useEffect(() => { if (stream.ended) void load() }, [stream.ended, load])
  const nodeStatuses = useMemo(() => mergeStatuses(staticStatusesFromDetail(detail), stream.nodeStatuses), [detail, stream.nodeStatuses])
  const waitingApproval = useMemo<WaitingApprovalNode | null>(() => {
    for (const [nodeId, snapshot] of nodeStatuses) if (snapshot.status === 'waiting-approval') return { nodeId, signalName: nodeId }
    return null
  }, [nodeStatuses])
  const selectedDetail = useMemo(() => detail?.nodes?.find((node) => node.nodeId === selectedNodeId) ?? null, [detail, selectedNodeId])

  useEffect(() => { if (focusRequest) document.getElementById(inspectorHeadingId)?.focus() }, [focusRequest])
  useEffect(() => {
    if (selectedNodeId === null && restoreFocus.current) { focusRunNode(layout.current, restoreFocus.current); restoreFocus.current = null }
  }, [selectedNodeId])
  const select = useCallback((nodeId: string) => { setSelectedNodeId(nodeId); setInspectorOpen(true); setFocusRequest((value) => value + 1) }, [])
  // Closing returns focus to the node that opened the inspector, unless the toggle closed it.
  const close = useCallback((returnFocus: boolean) => {
    if (returnFocus) restoreFocus.current = selectedNodeId
    setSelectedNodeId(null); setInspectorOpen(false)
  }, [selectedNodeId])
  const escape = useCallback(() => { if (selectedNodeId === null) return false; close(true); return true }, [selectedNodeId, close])

  if (failure && record === null) return <LoadFailure flowId={flowId} error={failure} retry={() => void load()} />
  if (loading && record === null) return <Loading />
  const definition = record?.definition ?? null
  const runStatus = detail?.status?.trim() || 'unknown'
  const known = Object.hasOwn(runStatusTones, runStatus)
  const runLabel = known ? t(`status.${runStatus}`) : runStatus
  const connection = stream.connection
  return <CanvasLayout ref={layout} embedded={true} fullScreen={false} mainId="flow-run-canvas" mainLabel={t('title')} skipLinkLabel={t('canvas')} className="console-flow-run min-w-0" data-testid="console-flow-run-page"
    toolbar={null} smallScreenNotice={<></>}
    paletteOpen={false} defaultPaletteOpen={false} onPaletteOpenChange={undefined} paletteLabel={t('canvas')} palette={null}
    inspectorOpen={inspectorOpen} defaultInspectorOpen={false} onInspectorOpenChange={(open) => { if (open) setInspectorOpen(true); else close(false) }} inspectorLabel={t('inspector')}
    inspector={selectedNodeId ? <Inspector key={selectedNodeId} nodeId={selectedNodeId} detail={selectedDetail} liveStatus={(nodeStatuses.get(selectedNodeId) as NodeStatusSnapshot | undefined) ?? null} onClose={() => close(true)} />
      : <Text variant="body" tone="muted">{t('inspectorEmpty')}</Text>}
    console={null} consoleLabel={t('canvas')} consoleActions={null} consoleOpen={false} defaultConsoleOpen={false} onConsoleOpenChange={undefined}
    header={<div className="min-w-0 w-full space-y-3">
      <PageHeader as="div" wrapTitle={true} title={record?.name ?? flowId} description={t('execution', { id: executionId })} breadcrumbs={[{ label: t('flows'), href: '/console/flows' }, { label: t('runs'), href: runsHref(flowId) }, { label: record?.name ?? flowId }]} status="" statuses={{}} meta={[]} tabs={null} actions={[]}
        labels={{ title: record?.name ?? flowId, description: t('execution', { id: executionId }), moreActions: t('actionsLabel'), sections: t('actionsLabel') }} />
      <div className="flex min-w-0 flex-wrap items-center gap-2" title={executionId}>
        <StatusTag status={runStatus} label={runLabel} statuses={{ [runStatus]: { label: runLabel, tone: known ? runStatusTones[runStatus as keyof typeof runStatusTones] : 'neutral' } }} uppercase={false} data-testid="run-status-badge" data-status={runStatus} />
        {terminal ? <Text variant="supporting" tone="muted" data-testid="run-static-indicator">{t('staticIndicator')}</Text>
          : connection === 'live' ? <StatusDot tone="success" pulse={true} label={t('live')} data-testid="run-streaming-indicator" />
            : <StatusDot tone="neutral" pulse={false} label={t('notLive')} data-testid="run-not-live-indicator" />}
      </div>
      {definition && <Actions workspaceId={workspaceId} flowId={flowId} executionId={executionId} status={detail?.status} waitingApproval={waitingApproval}
        onCancelled={() => void load()} onSignalSent={() => void load()} onRetried={(id) => navigate(`${runsHref(flowId)}/${encodeURIComponent(id)}`)} />}
      {failure && <div role="status" data-testid="run-reload-error"><InlineCallout tone="destructive" title={t('loadFailed')} description="" actions={[]} labels={{ title: t('loadFailed'), description: '', upgrade: '', viewUsage: '' }} icon={null} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" /></div>}
      {(connection === 'reconnecting' || connection === 'unavailable') && <div role="status" data-testid="run-stream-notice">
        <InlineCallout tone="warning" title={t(connection === 'reconnecting' ? 'reconnectingTitle' : 'unavailableTitle')} description={t(connection === 'reconnecting' ? 'reconnectingDescription' : 'unavailableDescription')} actions={[]}
          labels={{ title: t(connection === 'reconnecting' ? 'reconnectingTitle' : 'unavailableTitle'), description: t(connection === 'reconnecting' ? 'reconnectingDescription' : 'unavailableDescription'), upgrade: '', viewUsage: '' }} icon={null} dismissible={false} open={true} onDismiss={undefined} className="min-w-0" />
      </div>}
    </div>}>
    <div className="flex h-full min-w-0">
      {definition ? <RunCanvas definition={definition} nodeStatuses={nodeStatuses} selectedNodeId={selectedNodeId} onSelectNode={select} onEscape={escape} />
        : <div className="w-full p-6"><EmptyState icon={undefined} title={t('noDefinition')} description={t('noDefinitionDescription')} primaryAction={null} secondaryAction={null} titleAs="h2" bordered={false} className="min-w-0" /></div>}
    </div>
  </CanvasLayout>
}

function safeDecode(value: string) {
  try { return decodeURIComponent(value) } catch { return value }
}

export default function ConsoleFlowRunPage() {
  const { t, i18n: language } = useTranslation('pages.console-flow-run-page')
  const { flowId, executionId } = useParams()
  const { activeWorkspaceId } = useConsoleContext()
  return <I18nProvider locale={language.language}><LiveAnnouncer><ToastProvider timeout={5000} limit={3}>
    {!flowId || !executionId ? <section><h1 className="text-lg font-semibold">{t('title')}</h1><WorkspaceGate missingIds={true} /></section>
      : !activeWorkspaceId ? <section><h1 className="text-lg font-semibold">{t('title')}</h1><WorkspaceGate /></section>
        : <RunView key={`${activeWorkspaceId}:${flowId}:${executionId}`} workspaceId={activeWorkspaceId} flowId={flowId} executionId={safeDecode(executionId)} />}
    <LocalizedToaster />
  </ToastProvider></LiveAnnouncer></I18nProvider>
}
