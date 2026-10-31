import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { applyEdgeChanges, applyNodeChanges, Background, Controls, ReactFlow, useReactFlow, type Connection, type EdgeChange, type IsValidConnection, type Edge, type Node, type NodeChange, type AriaLabelConfig, type OnConnectEnd } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Badge, CanvasLayout, EmptyState, Link, StatusTag, Tabs, TabsList, TabsTab, Text } from '@gntik-ai/ui'
import { PageHeader } from '@gntik-ai/blocks'
import { FlowYamlEditor, type FlowEditorValidity } from './FlowYamlEditor'
import { FLOW_PALETTE_DRAG_MIME, FlowPalette, FlowProblemsPanel, FlowRunTriggerButton, Callout, Loading, LoadFailure, failureFrom, useNotify, useErrorMessage, type FlowProblem, type Failure } from './chrome'
import { DesignerButton as Button, focus } from './controls'
import { useCopy } from './copy'
import { evaluateConnection } from './connectionRules'
import { definitionToEdges, definitionToNodes, nodesToDefinition, type FlowCanvasEdge, type FlowCanvasNode, type FlowCanvasNodeData, type FlowEdgeKind } from './flowGraphModel'
import { flowNodeTypes } from './nodes/nodeTypes'
import { NodePropertyPanel } from './panels/NodePropertyPanel'
import { groupErrorsByNode, validateFlowSemantics } from './semanticValidation'
import { parseYamlToFlow, serializeFlowToYaml } from './yaml-serialiser'
import type { ViewMode } from './view-sync'
import { getFlow, isFlowApiError, publishFlow, updateFlowDraft, type FlowDefinitionRecord, type FlowScheduleTriggerAck } from './api'
import type { FlowDefinition, FlowNode, TaskTypeDescriptor, ValidationError } from './flows'
import { describeFlowValidationError } from './validation-errors'
import './page.css'

type DesignerNode = Node<FlowCanvasNodeData>

function emptyDefinition(name: string): FlowDefinition {
  return { apiVersion: 'v1.0', name, nodes: [] }
}

// Fresh drafts may arrive as `definition: {}`; normalize the authoring projection shape only.
function normalizeDefinition(
  definition: Partial<FlowDefinition> | undefined,
  name: string
): FlowDefinition {
  if (!definition || typeof definition !== 'object') return emptyDefinition(name)
  return {
    ...emptyDefinition(name),
    ...definition,
    apiVersion: definition.apiVersion === 'v1.0' ? definition.apiVersion : 'v1.0',
    name: typeof definition.name === 'string' && definition.name.trim() ? definition.name : name,
    nodes: Array.isArray(definition.nodes) ? definition.nodes : []
  }
}

function nodeDisplayLabel(dsl: FlowNode): string {
  if (dsl.name && dsl.name.trim()) return dsl.name
  if (dsl.type === 'task') return dsl.taskType
  if (dsl.type === 'sub-flow') return `${dsl.flowId}@${dsl.flowVersion}`
  return dsl.type
}

function buildTriggerNavigationState(flowId: string, ack: FlowScheduleTriggerAck) {
  return {
    flowTrigger: {
      flowId,
      scheduleId: ack.scheduleId,
      triggeredAt: new Date().toISOString()
    }
  }
}

// Derive the DSL edge kind for a freshly drawn connection from the source node type and
// the source handle id (must mirror the handle ids rendered by the node components and
// the kinds consumed by flowGraphModel.ts::rebuildNodeEdges).
function connectionKind(
  sourceType: string | undefined,
  sourceHandle: string | null | undefined
): { kind: FlowEdgeKind; armIndex?: number } {
  if (sourceType === 'branch') {
    if (sourceHandle && sourceHandle.startsWith('arm-')) {
      return { kind: 'arm', armIndex: Number(sourceHandle.slice(4)) }
    }
    return { kind: 'default' }
  }
  if (sourceType === 'parallel' && sourceHandle === 'branches') return { kind: 'branch' }
  if (sourceType === 'sequence' && sourceHandle === 'steps') return { kind: 'step' }
  return { kind: 'next' }
}

export function DesignerSurface({ workspaceId, flowId }: { workspaceId: string; flowId: string }) {
  const { t, i18n } = useCopy()
  const notify = useNotify(), errorMessage = useErrorMessage()
  const navigate = useNavigate()
  const [loadFailure, setLoadFailure] = useState<Failure | null>(null)
  const initialRequest = useRef<Promise<FlowDefinitionRecord> | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(() => typeof matchMedia !== 'undefined' ? matchMedia('(min-width: 1024px)').matches : true)
  const [inspectorOpen, setInspectorOpen] = useState(() => typeof matchMedia !== 'undefined' ? matchMedia('(min-width: 1024px)').matches : true)
  const [consoleOpen, setConsoleOpen] = useState(true)
  const operation = useRef(false)
  const pendingFocus = useRef<string | null>(null)
  const { screenToFlowPosition } = useReactFlow()
  const canvasRef = useRef<HTMLDivElement | null>(null)

  const [record, setRecord] = useState<FlowDefinitionRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<DesignerNode[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [taskTypes, setTaskTypes] = useState<TaskTypeDescriptor[]>([])
  const [serverErrors, setServerErrors] = useState<ValidationError[]>([])
  const [interactionProblems, setInteractionProblems] = useState<FlowProblem[]>([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null)

  // YAML view state. The canvas and YAML are two views of one canonical document; YAML edits
  // are flushed back into the canvas node/edge model on a valid switch (see flushYamlToCanvas).
  const [viewMode, setViewMode] = useState<ViewMode>('canvas')
  const [yamlText, setYamlText] = useState<string>('')
  const [yamlValidity, setYamlValidity] = useState<FlowEditorValidity>({
    parseable: true,
    valid: true,
    markers: []
  })

  const baseDefinition: FlowDefinition = useMemo(
    () => normalizeDefinition(record?.definition, record?.name ?? flowId),
    [record, flowId]
  )

  const resetFromRecord = useCallback((loaded: FlowDefinitionRecord) => {
    const definition = normalizeDefinition(loaded.definition, loaded.name || loaded.flowId)
    setRecord(loaded)
    setNodes(definitionToNodes(definition) as DesignerNode[])
    setEdges(definitionToEdges(definition) as Edge[])
    setServerErrors([])
    setInteractionProblems([])
    setDirty(false)
    setYamlText(serializeFlowToYaml(definition))
    setYamlValidity({ parseable: true, valid: true, markers: [] })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    setLoadFailure(null)
    try {
      const loaded = await getFlow(workspaceId, flowId)
      resetFromRecord(loaded)
      return true
    } catch (error) {
      setLoadFailure(failureFrom(error)); setLoadError(errorMessage(error, 'errorDescription')); notify(errorMessage(error, 'errorDescription'), true)
      return false
    } finally {
      setLoading(false)
    }
  }, [workspaceId, flowId, resetFromRecord, errorMessage, notify])

  useEffect(() => {
    let active = true
    if (!initialRequest.current) initialRequest.current = getFlow(workspaceId, flowId)
    void initialRequest.current.then((loaded) => { if (active) resetFromRecord(loaded) }).catch((error: unknown) => {
      if (active) { setLoadFailure(failureFrom(error)); setLoadError(errorMessage(error, 'errorDescription')); notify(errorMessage(error, 'errorDescription'), true) }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [workspaceId, flowId, resetFromRecord])

  // Project the live canvas back to the DSL: this is exactly what a save would persist.
  const currentDefinition = useMemo(
    () =>
      nodesToDefinition(
        baseDefinition,
        nodes as unknown as FlowCanvasNode[],
        edges as unknown as FlowCanvasEdge[]
      ),
    [baseDefinition, nodes, edges]
  )

  // Seed / refresh the YAML buffer from the canvas whenever the editor is not the active
  // editing surface, so opening the YAML view always reflects the current canvas (canonical,
  // comment-free serialisation).
  useEffect(() => {
    if (viewMode === 'canvas') {
      setYamlText(serializeFlowToYaml(currentDefinition))
    }
  }, [viewMode, currentDefinition])

  const taskTypeIds = useMemo(
    () => (taskTypes.length > 0 ? taskTypes.map((descriptor) => descriptor.id) : undefined),
    [taskTypes]
  )

  // Flush a (valid) YAML buffer back into the canvas node/edge model. Returns false when the
  // YAML is syntactically invalid so the caller can block a view switch and warn.
  const flushYamlToCanvas = useCallback((): boolean => {
    try {
      const definition = parseYamlToFlow(yamlText)
      setNodes(definitionToNodes(definition) as DesignerNode[])
      setEdges(definitionToEdges(definition) as Edge[])
      setDirty(true)
      return true
    } catch {
      return false
    }
  }, [yamlText])

  // Switch view. Leaving the YAML editor for a canvas-bearing mode requires syntactically
  // valid YAML; otherwise the switch is blocked and the YAML view stays put with markers.
  const switchView = useCallback(
    (mode: ViewMode) => {
      const leavingYaml = viewMode === 'yaml' || viewMode === 'side-by-side'
      const enteringCanvas = mode === 'canvas' || mode === 'side-by-side'
      if (leavingYaml && enteringCanvas) {
        if (!flushYamlToCanvas()) return // invalid YAML — block the switch
      }
      setViewMode(mode)
    },
    [viewMode, flushYamlToCanvas]
  )

  // Client-side semantic validation (FLW-E001…FLW-E009) on every graph change.
  const semanticErrors = useMemo(
    () =>
      validateFlowSemantics(currentDefinition, {
        taskTypeCatalog: taskTypeIds
      }),
    [currentDefinition, taskTypeIds]
  )

  const allProblems = useMemo(
    () => [...semanticErrors, ...serverErrors, ...interactionProblems],
    [semanticErrors, serverErrors, interactionProblems]
  )

  // Distribute node-scoped errors (client + server) onto data.validationErrors.
  const decoratedNodes = useMemo(() => {
    const byNode = groupErrorsByNode([...semanticErrors, ...serverErrors])
    return nodes.map((node) => ({
      ...node,
      ariaLabel: t('nodeNamed', { type: t(`nodeTypes.${node.type}`), name: node.data.label === node.data.dsl.type ? t(`nodeTypes.${node.data.dsl.type}`) : node.data.label }),
      domAttributes: { 'aria-description': [t('nodeDescription'), ...(byNode.get(node.id) ?? []).map((error) => describeFlowValidationError(error, i18n.language))].join('. ') },
      data: { ...node.data, label: node.data.label === node.data.dsl.type ? t(`nodeTypes.${node.data.dsl.type}`) : node.data.label, validationErrors: byNode.get(node.id) ?? [] }
    }))
  }, [nodes, semanticErrors, serverErrors, t, i18n.language])

  const onNodesChange = useCallback((changes: NodeChange<DesignerNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
    if (changes.some((change) => change.type !== 'select' && change.type !== 'dimensions')) {
      setDirty(true)
    }
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current))
    if (changes.some((change) => change.type !== 'select')) {
      setDirty(true)
    }
  }, [])

  const isValidConnection: IsValidConnection<Edge> = useCallback(
    (connection) => {
      const verdict = evaluateConnection(
        {
          source: connection.source ?? null,
          target: connection.target ?? null,
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle
        },
        nodes as unknown as FlowCanvasNode[],
        edges as unknown as FlowCanvasEdge[]
      )
      return verdict.ok
    },
    [nodes, edges, t]
  )

  const onConnect = useCallback(
    (connection: Connection) => {
      const verdict = evaluateConnection(
        {
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle
        },
        nodes as unknown as FlowCanvasNode[],
        edges as unknown as FlowCanvasEdge[]
      )
      if (!verdict.ok) {
        // isValidConnection already blocks these during the gesture; keep a Problems
        // entry so the rejection is explained rather than silent.
        setInteractionProblems((current) => [
          ...current.slice(-4),
          { source: 'interaction', code: verdict.code ?? 'CONNECTION_REJECTED', nodeId: connection.source, message: t(`connection.${verdict.code ?? 'CONNECTION_REJECTED'}`, { source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle ?? '', type: nodes.find((node) => node.id === connection.source)?.type ?? '' }) }
        ])
        return
      }
      const sourceNode = nodes.find((node) => node.id === connection.source)
      const { kind, armIndex } = connectionKind(sourceNode?.type, connection.sourceHandle)
      const edge: FlowCanvasEdge = {
        id: `${connection.source}__${connection.sourceHandle ?? kind}__${connection.target}`,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        data: { kind, armIndex }
      }
      setEdges((current) => [...current, edge as Edge])
      setInteractionProblems([])
      setDirty(true)
    },
    [nodes, edges, t]
  )

  const onConnectEnd: OnConnectEnd = useCallback((_event, state) => {
    if (state.isValid || !state.fromNode || !state.toNode || !state.fromHandle || !state.toHandle) return
    const forward = state.fromHandle.type === 'source'
    const connection = { source: forward ? state.fromNode.id : state.toNode.id, target: forward ? state.toNode.id : state.fromNode.id,
      sourceHandle: forward ? state.fromHandle.id : state.toHandle.id, targetHandle: forward ? state.toHandle.id : state.fromHandle.id }
    const verdict = evaluateConnection(connection, nodes as unknown as FlowCanvasNode[], edges as unknown as FlowCanvasEdge[])
    if (!verdict.ok) setInteractionProblems((current) => [...current.slice(-4), { source: 'interaction', code: verdict.code ?? 'CONNECTION_REJECTED', nodeId: connection.source,
      message: t(`connection.${verdict.code ?? 'CONNECTION_REJECTED'}`, { ...connection, type: nodes.find((node) => node.id === connection.source)?.type ?? '' }) }])
  }, [nodes, edges, t])

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (event.dataTransfer.types.includes(FLOW_PALETTE_DRAG_MIME)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    }
  }, [])

  const insertTask = useCallback((descriptor: TaskTypeDescriptor, position: { x: number; y: number }, keyboard: boolean) => {
    setNodes((current) => {
      const base = descriptor.id.replace(/[^a-zA-Z0-9_-]/g, '-')
      let counter = 1, id = `${base}-${counter}`
      const ids = new Set(current.map((node) => node.id))
      while (ids.has(id)) { counter += 1; id = `${base}-${counter}` }
      const dsl: FlowNode = { id, type: 'task', taskType: descriptor.id, input: {} }
      if (keyboard) pendingFocus.current = id
      return [...current, { id, type: 'task', position, data: { dsl, label: nodeDisplayLabel(dsl), validationErrors: [] } }]
    })
    setDirty(true)
  }, [])
  const onInsert = useCallback((descriptor: TaskTypeDescriptor) => {
    const bounds = canvasRef.current?.getBoundingClientRect()
    insertTask(descriptor, screenToFlowPosition({ x: bounds ? bounds.left + bounds.width / 2 : 0, y: bounds ? bounds.top + bounds.height / 2 : 0 }), true)
  }, [insertTask, screenToFlowPosition])
  const onDrop = useCallback((event: React.DragEvent) => {
    const payload = event.dataTransfer.getData(FLOW_PALETTE_DRAG_MIME)
    if (!payload) return
    event.preventDefault()
    let descriptor: TaskTypeDescriptor
    try { descriptor = JSON.parse(payload) as TaskTypeDescriptor } catch { return }
    insertTask(descriptor, screenToFlowPosition({ x: event.clientX, y: event.clientY }), false)
  }, [insertTask, screenToFlowPosition])
  const focusNode = useCallback((nodeId: string) => {
    const element = Array.from(canvasRef.current?.querySelectorAll<HTMLElement>('.react-flow__node') ?? []).find((item) => item.dataset.id === nodeId)
    element?.focus()
  }, [])
  useEffect(() => {
    if (!pendingFocus.current) return
    const id = pendingFocus.current
    const frame = requestAnimationFrame(() => { focusNode(id); pendingFocus.current = null })
    return () => cancelAnimationFrame(frame)
  }, [nodes, focusNode])

  // Property-panel edits flow straight into the in-memory DSL model (no save).
  const onChangeDsl = useCallback((nodeId: string, nextDsl: FlowNode) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, dsl: nextDsl, label: nodeDisplayLabel(nextDsl) } }
          : node
      )
    )
    setDirty(true)
  }, [])

  const selectNode = useCallback((nodeId: string) => {
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === nodeId })))
    setInspectorOpen(true)
    requestAnimationFrame(() => focusNode(nodeId))
  }, [focusNode])

  const selectedNode = useMemo(
    () => (nodes.find((node) => node.selected) as unknown as FlowCanvasNode | undefined) ?? null,
    [nodes]
  )

  const applyServerRejection = useCallback((error: unknown): string => {
    if (isFlowApiError(error)) {
      // Preserve structured localization params. Render sites use the console formatter
      // and never echo the shared validator's English message (console policy 743).
      setServerErrors(
        error.body.errors.map((entry) => ({
          code: entry.code,
          nodeId: entry.nodeId ?? null,
          message: entry.message,
          ...(entry.params ? { params: entry.params } : {})
        }))
      )
      // The flow-level banner text, however, is NOT guaranteed to be validation-owned copy —
      // `toFlowApiError` (flowsApi.ts) wraps ANY publish/validate rejection this way, including a
      // 404/500 unrelated to validation. Map it through the shared, localized helper: a real 422
      // (no recognized status mapping) falls back to the validation-aware copy below; a genuine
      // transport failure (404/500/...) gets its proper localized status text instead of the raw
      // backend message.
      return errorMessage(error, error.body.errors.length > 0 ? 'validationFailed' : 'requestFailed')
    }
    return errorMessage(error, 'requestFailed')
  }, [errorMessage])

  // When the YAML editor is the active surface the YAML buffer is the source of truth; resolve
  // the definition to persist from it (falling back to the canvas projection on the canvas view).
  const resolveDefinitionToSave = useCallback((): FlowDefinition | null => {
    if (viewMode === 'yaml' || viewMode === 'side-by-side') {
      try {
        return parseYamlToFlow(yamlText)
      } catch {
        return null // invalid YAML — caller must NOT persist
      }
    }
    return currentDefinition
  }, [viewMode, yamlText, currentDefinition])

  const saveDraft = useCallback(async (): Promise<boolean> => {
    // Graceful-degradation guard: never PATCH /flows/:id while the YAML editor holds an
    // invalid document. The stored draft keeps its last-valid value.
    const definitionToSave = resolveDefinitionToSave()
    if (definitionToSave === null) {
      setLoadError(t('invalidYaml')); notify(t('invalidYaml'), true)
      return false
    }
    setSaving(true)
    setLoadError(null)
    try {
      const saved = await updateFlowDraft(workspaceId, flowId, { definition: definitionToSave })
      setRecord(saved)
      setServerErrors([])
      setDirty(false)
      setSavedAt(new Date().toISOString())
      notify(t('saved'))
      return true
    } catch (error) {
      const message = applyServerRejection(error)
      setLoadError(message); notify(message, true)
      return false
    } finally {
      setSaving(false)
    }
  }, [workspaceId, flowId, resolveDefinitionToSave, applyServerRejection, notify, t])

  const revert = useCallback(async () => {
    const loaded = await load()
    if (loaded) notify(t('reverted'))
    setSavedAt(null)
  }, [load, notify, t])

  const publish = useCallback(async () => {
    if (operation.current) return
    operation.current = true
    setPublishing(true)
    setLoadError(null)
    try {
      // Publish pins a version of the PERSISTED draft, so save the canvas first.
      const saved = await saveDraft()
      if (!saved) return
      const result = await publishFlow(workspaceId, flowId)
      setPublishedVersion(result.version)
      setRecord((current) => (current ? { ...current, status: 'published' } : current))
      notify(t('published', { version: result.version }))
      setServerErrors([])
    } catch (error) {
      const message = applyServerRejection(error)
      setLoadError(message); notify(message, true)
    } finally {
      setPublishing(false); operation.current = false
    }
  }, [workspaceId, flowId, saveDraft, applyServerRejection, notify, t])

  // When editing YAML, the FLW-E semantic markers come from the editor's own validation; fold
  // them (and any syntax error) into the publish/save gate.
  const yamlBlocking =
    viewMode !== 'canvas' && (!yamlValidity.parseable || yamlValidity.markers.length > 0)
  const blockingErrors =
    semanticErrors.length + serverErrors.length + (yamlBlocking ? yamlValidity.markers.length + 1 : 0)

  const ariaLabelConfig: Partial<AriaLabelConfig> = {
    'node.a11yDescription.default': t('nodeDescription'),
    'node.a11yDescription.keyboardDisabled': t('nodeDescription'),
    'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) => t('nodeMoved', { direction: t(`directions.${direction}`), x, y }),
    'edge.a11yDescription.default': t('edgeDescription'),
    'controls.ariaLabel': t('controls.ariaLabel'),
    'handle.ariaLabel': t('handle.ariaLabel'),
    'minimap.ariaLabel': t('minimap.ariaLabel'),
    'controls.zoomIn.ariaLabel': t('zoomIn'), 'controls.zoomOut.ariaLabel': t('zoomOut'),
    'controls.fitView.ariaLabel': t('fitView'), 'controls.interactive.ariaLabel': t('toggleInteractive'),
  }
  function canvasKey(event: React.KeyboardEvent) {
    const element = (event.target as HTMLElement).closest<HTMLElement>('.react-flow__node')
    if (!element?.dataset.id) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation()
      selectNode(element.dataset.id); setInspectorOpen(true)
      requestAnimationFrame(() => document.getElementById('flow-inspector-heading')?.focus())
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation()
      setNodes((current) => current.map((node) => ({ ...node, selected: false })))
      element.focus()
    }
  }
  const renderCanvasSurface = <section ref={canvasRef} className="designer-canvas relative min-w-0 flex-1" aria-label={t('canvas')} onDragOver={onDragOver} onDrop={onDrop} onKeyDownCapture={canvasKey}>
    <ReactFlow nodes={decoratedNodes} edges={edges.map((edge) => ({ ...edge, ariaLabel: t('edgeNamed', { source: edge.source, target: edge.target }), label: edge.data?.kind === 'default' ? t('defaultConnection') : edge.label }))} nodeTypes={flowNodeTypes}
      onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onConnectEnd={onConnectEnd} isValidConnection={isValidConnection}
      onNodeClick={(_event, node) => { selectNode(node.id); setInspectorOpen(true) }} ariaLabelConfig={ariaLabelConfig}
      fitView={true} proOptions={{ hideAttribution: true }}>
      <Background gap={16} /><Controls />
    </ReactFlow>
    {nodes.length === 0 && <div className="pointer-events-none absolute inset-x-0 top-8"><EmptyState icon={undefined} title={t('emptyCanvas')} description={t('emptyCanvasDescription')} primaryAction={null} secondaryAction={null} titleAs="h2" bordered={false} className="min-w-0" /></div>}
  </section>
  const renderYamlSurface = <div className="designer-yaml flex min-w-0 flex-1 flex-col" data-testid="designer-yaml-pane">
    {!yamlValidity.parseable && <div data-testid="designer-yaml-degraded-banner"><Callout warning={true} message={t('degraded')} /></div>}
    <FlowYamlEditor value={yamlText} onChange={(text) => { setYamlText(text); setDirty(true) }} taskTypeCatalog={taskTypeIds} onValidityChange={setYamlValidity} readOnly={false} />
  </div>
  if (loadFailure && record === null) return <section><h1 className="text-lg font-semibold">{t('title')}</h1><LoadFailure error={loadFailure} retry={() => void load()} /></section>
  if (loading && record === null) return <Loading />
  const status = record?.status?.trim() || 'draft'
  const statusLabel = ['draft', 'published', 'archived', 'failed'].includes(status) ? t(`status.${status}`) : status
  return <CanvasLayout embedded={true} fullScreen={false} mainId="flow-designer-canvas" mainLabel={t('view')} skipLinkLabel={t('canvas')} className="console-flow-designer min-w-0" data-testid="console-flow-designer-page"
    toolbar={null} smallScreenNotice={<></>}
    paletteOpen={paletteOpen} defaultPaletteOpen={true} onPaletteOpenChange={setPaletteOpen} paletteLabel={t('palette')}
    palette={<FlowPalette workspaceId={workspaceId} onCatalogLoaded={setTaskTypes} onInsert={onInsert} />}
    inspectorOpen={inspectorOpen} defaultInspectorOpen={true} onInspectorOpenChange={setInspectorOpen} inspectorLabel={t('inspector')}
    inspector={selectedNode && viewMode !== 'yaml' ? <div onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); const id = selectedNode.id; setNodes((current) => current.map((node) => ({ ...node, selected: false }))); requestAnimationFrame(() => focusNode(id)) } }}><NodePropertyPanel key={selectedNode.id} node={selectedNode} taskTypes={taskTypes} onChangeDsl={onChangeDsl} /></div> : <Text variant="body" tone="muted">{t('inspectorEmpty')}</Text>}
    console={allProblems.length ? <FlowProblemsPanel problems={allProblems} onSelectNode={selectNode} /> : null} consoleLabel={t('problems', { count: allProblems.length })} consoleActions={null}
    consoleOpen={consoleOpen} defaultConsoleOpen={true} onConsoleOpenChange={setConsoleOpen}
    header={<div className="min-w-0 w-full space-y-3">
      <PageHeader as="div" wrapTitle={true} title={record?.name ?? flowId} description="" breadcrumbs={[{ label: t('flows'), href: '/console/flows' }]} status="" statuses={{}} meta={[]} tabs={null} actions={[]} labels={{ title: record?.name ?? flowId, description: '', moreActions: t('actions'), sections: t('actions') }} />
      <div className="flex min-w-0 flex-wrap items-center gap-2"><StatusTag status={status} label={statusLabel} statuses={{ [status]: { label: statusLabel, tone: status === 'published' ? 'success' : status === 'draft' ? 'warning' : status === 'failed' ? 'destructive' : 'neutral' } }} uppercase={false} />
        {publishedVersion !== null && <Badge variant="soft" tone="success" data-testid="published-version-badge">{t('published', { version: publishedVersion })}</Badge>}
        {dirty ? <Text variant="supporting" tone="warning" data-testid="unsaved-changes-indicator">{t('unsaved')}</Text> : savedAt ? <Text variant="supporting" tone="success" data-testid="saved-indicator">{t('saved')}</Text> : null}
      </div>
      <Tabs value={viewMode} defaultValue="canvas" variant="pills" onValueChange={(value) => switchView(value as ViewMode)} className="min-w-0">
        <TabsList indicator={true} fullWidth={false} aria-label={t('view')} data-testid="flow-view-switcher">{(['canvas', 'yaml', 'side-by-side'] as const).map((mode) => <TabsTab key={mode} value={mode} icon={undefined} count={undefined} className={focus} data-testid={`view-mode-${mode}`}>{t(mode)}</TabsTab>)}</TabsList>
      </Tabs>
      <div role="group" aria-label={t('actions')} className="flex min-w-0 flex-wrap items-center gap-2">
        <FlowRunTriggerButton workspaceId={workspaceId} flowId={flowId} flowName={record?.name ?? flowId} status={record?.status} onTriggered={(ack) => navigate(`/console/flows/${encodeURIComponent(flowId)}/runs`, { state: buildTriggerNavigationState(flowId, ack) })} />
        <Link href={`/console/flows/${encodeURIComponent(flowId)}/runs`} tone="primary" underline="always" external={false} externalLabel="" aria-label={t('historyNamed', { name: record?.name ?? flowId })} className={focus}>{t('history')}</Link>
        <Button variant="ghost" disabled={saving || publishing} onClick={() => void revert()}>{t('revert')}</Button>
        <Button variant="secondary" disabled={saving || publishing} onClick={() => void saveDraft()} data-testid="save-draft-button">{t(saving ? 'saving' : 'save')}</Button>
        <Button variant="primary" disabled={saving || publishing || blockingErrors > 0} title={blockingErrors > 0 ? t('publishBlocked') : undefined} onClick={() => void publish()} data-testid="publish-button">{t(publishing ? 'publishing' : 'publish')}</Button>
      </div>
      {loadError && <div data-testid="designer-error-banner"><Callout message={loadError} /></div>}
    </div>}>
    <div className={`designer-views flex h-full min-w-0 ${viewMode === 'side-by-side' ? 'flex-col xl:flex-row' : ''}`}>
      {(viewMode === 'canvas' || viewMode === 'side-by-side') && renderCanvasSurface}
      {(viewMode === 'yaml' || viewMode === 'side-by-side') && renderYamlSurface}
    </div>
  </CanvasLayout>
}
