// Visual flow designer page (change: add-console-flow-designer).
//
// Composes the @xyflow/react canvas, the server-driven task-type palette, the per-node
// property panel, the Problems panel, and the draft/publish toolbar. Lazy-loaded from
// router.tsx so the canvas chunk stays out of the initial shell bundle.
//
// Validation model:
//   - client-side: the SHARED FLW-E001…FLW-E009 rule set runs in a useMemo on every
//     graph change over the projected DSL (semanticValidation.ts);
//   - interaction-time: connectionRules.ts inside isValidConnection (illegal edges are
//     never committed; the rejection is surfaced in the Problems panel);
//   - server-side: 422 errors from validate/publish are merged per nodeId onto the
//     canvas nodes; errors without nodeId show as flow-level Problems entries.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { History } from 'lucide-react'
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type IsValidConnection,
  type Edge,
  type Node,
  type NodeChange
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { FlowYamlEditor, type FlowEditorValidity } from '@/components/flows/FlowYamlEditor'
import { FLOW_PALETTE_DRAG_MIME, FlowPalette } from '@/components/flows/FlowPalette'
import { FlowProblemsPanel } from '@/components/flows/FlowProblemsPanel'
import { evaluateConnection } from '@/components/flows/connectionRules'
import {
  definitionToEdges,
  definitionToNodes,
  nodesToDefinition,
  type FlowCanvasEdge,
  type FlowCanvasNode,
  type FlowCanvasNodeData,
  type FlowEdgeKind
} from '@/components/flows/flowGraphModel'
import { flowNodeTypes } from '@/components/flows/nodes/nodeTypes'
import { NodePropertyPanel } from '@/components/flows/panels/NodePropertyPanel'
import {
  groupErrorsByNode,
  validateFlowSemantics
} from '@/components/flows/semanticValidation'
import { parseYamlToFlow, serializeFlowToYaml } from '@/lib/flows/yaml-serialiser'
import type { ViewMode } from '@/lib/flows/view-sync'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConsoleContext } from '@/lib/console-context'
import {
  getFlow,
  isFlowApiError,
  publishFlow,
  updateFlowDraft,
  type FlowDefinitionRecord
} from '@/services/flowsApi'
import type { FlowDefinition, FlowNode, TaskTypeDescriptor, ValidationError } from '@/types/flows'

type DesignerNode = Node<FlowCanvasNodeData>

function emptyDefinition(name: string): FlowDefinition {
  return { apiVersion: 'v1.0', name, nodes: [] }
}

function nodeDisplayLabel(dsl: FlowNode): string {
  if (dsl.name && dsl.name.trim()) return dsl.name
  if (dsl.type === 'task') return dsl.taskType
  if (dsl.type === 'sub-flow') return `${dsl.flowId}@${dsl.flowVersion}`
  return dsl.type
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

function DesignerSurface({ workspaceId, flowId }: { workspaceId: string; flowId: string }) {
  const { screenToFlowPosition } = useReactFlow()
  const canvasRef = useRef<HTMLDivElement | null>(null)

  const [record, setRecord] = useState<FlowDefinitionRecord | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<DesignerNode[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [taskTypes, setTaskTypes] = useState<TaskTypeDescriptor[]>([])
  const [serverErrors, setServerErrors] = useState<ValidationError[]>([])
  const [interactionProblems, setInteractionProblems] = useState<ValidationError[]>([])
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
    () => record?.definition ?? emptyDefinition(record?.name ?? flowId),
    [record, flowId]
  )

  const resetFromRecord = useCallback((loaded: FlowDefinitionRecord) => {
    const definition = loaded.definition ?? emptyDefinition(loaded.name ?? '')
    setRecord(loaded)
    setNodes(definitionToNodes(definition) as DesignerNode[])
    setEdges(definitionToEdges(definition) as Edge[])
    setServerErrors([])
    setInteractionProblems([])
    setDirty(false)
  }, [])

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const loaded = await getFlow(workspaceId, flowId)
      resetFromRecord(loaded)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load the flow')
    }
  }, [workspaceId, flowId, resetFromRecord])

  useEffect(() => {
    void load()
  }, [load])

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
      data: { ...node.data, validationErrors: byNode.get(node.id) ?? [] }
    }))
  }, [nodes, semanticErrors, serverErrors])

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
    [nodes, edges]
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
          { code: verdict.code ?? 'CONNECTION_REJECTED', nodeId: connection.source, message: verdict.message ?? 'Connection rejected.' }
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
    [nodes, edges]
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (event.dataTransfer.types.includes(FLOW_PALETTE_DRAG_MIME)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    }
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      const payload = event.dataTransfer.getData(FLOW_PALETTE_DRAG_MIME)
      if (!payload) return
      event.preventDefault()
      let descriptor: TaskTypeDescriptor
      try {
        descriptor = JSON.parse(payload) as TaskTypeDescriptor
      } catch {
        return
      }
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setNodes((current) => {
        const base = descriptor.id.replace(/[^a-zA-Z0-9_-]/g, '-')
        let counter = 1
        let id = `${base}-${counter}`
        const ids = new Set(current.map((node) => node.id))
        while (ids.has(id)) {
          counter += 1
          id = `${base}-${counter}`
        }
        const dsl: FlowNode = { id, type: 'task', taskType: descriptor.id, input: {} }
        const node: FlowCanvasNode = {
          id,
          type: 'task',
          position,
          data: { dsl, label: nodeDisplayLabel(dsl), validationErrors: [] }
        }
        return [...current, node as DesignerNode]
      })
      setDirty(true)
    },
    [screenToFlowPosition]
  )

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
  }, [])

  const selectedNode = useMemo(
    () => (nodes.find((node) => node.selected) as unknown as FlowCanvasNode | undefined) ?? null,
    [nodes]
  )

  const applyServerRejection = useCallback((error: unknown): string => {
    if (isFlowApiError(error)) {
      setServerErrors(
        error.body.errors.map((entry) => ({
          code: entry.code,
          nodeId: entry.nodeId ?? null,
          message: entry.message
        }))
      )
      return error.message
    }
    return error instanceof Error ? error.message : 'Request failed'
  }, [])

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
      setLoadError('The YAML document is invalid — fix the highlighted errors before saving.')
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
      return true
    } catch (error) {
      setLoadError(applyServerRejection(error))
      return false
    } finally {
      setSaving(false)
    }
  }, [workspaceId, flowId, resolveDefinitionToSave, applyServerRejection])

  const revert = useCallback(async () => {
    await load()
    setSavedAt(null)
  }, [load])

  const publish = useCallback(async () => {
    setPublishing(true)
    setLoadError(null)
    try {
      // Publish pins a version of the PERSISTED draft, so save the canvas first.
      const saved = await saveDraft()
      if (!saved) return
      const result = await publishFlow(workspaceId, flowId)
      setPublishedVersion(result.version)
      setServerErrors([])
    } catch (error) {
      setLoadError(applyServerRejection(error))
    } finally {
      setPublishing(false)
    }
  }, [workspaceId, flowId, saveDraft, applyServerRejection])

  // When editing YAML, the FLW-E semantic markers come from the editor's own validation; fold
  // them (and any syntax error) into the publish/save gate.
  const yamlBlocking =
    viewMode !== 'canvas' && (!yamlValidity.parseable || yamlValidity.markers.length > 0)
  const blockingErrors =
    semanticErrors.length + serverErrors.length + (yamlBlocking ? yamlValidity.markers.length + 1 : 0)

  const renderCanvasSurface = (
    <main ref={canvasRef} className="min-w-0 flex-1" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={decoratedNodes}
        edges={edges}
        nodeTypes={flowNodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} />
        <Controls />
      </ReactFlow>
    </main>
  )

  const renderYamlSurface = (
    <div className="min-w-0 flex-1 border-l border-border" data-testid="designer-yaml-pane">
      {viewMode !== 'canvas' && !yamlValidity.parseable ? (
        <p
          className="bg-amber-100 px-3 py-1 text-xs text-amber-800"
          role="status"
          data-testid="designer-yaml-degraded-banner"
        >
          The YAML is invalid — the canvas keeps the last valid version and the draft will not be saved until you fix it.
        </p>
      ) : null}
      <FlowYamlEditor
        value={yamlText}
        onChange={setYamlText}
        taskTypeCatalog={taskTypeIds}
        onValidityChange={setYamlValidity}
      />
    </div>
  )

  if (loadError && record === null) {
    return (
      <div className="space-y-2 p-6 text-sm">
        <p className="text-destructive">{loadError}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col" data-testid="console-flow-designer-page">
      <header className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Link className="text-sm text-muted-foreground hover:underline" to="/console/flows">
            Flows
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="max-w-[18rem] truncate text-sm font-semibold sm:max-w-[24rem]" title={record?.name ?? flowId}>
            {record?.name ?? flowId}
          </span>
          <Badge variant="outline" className="text-xs">
            {record?.status ?? 'draft'}
          </Badge>
          {publishedVersion !== null ? (
            <Badge className="text-xs" data-testid="published-version-badge">
              v{publishedVersion} published
            </Badge>
          ) : null}
          {dirty ? (
            <span data-testid="unsaved-changes-indicator" className="text-xs text-amber-600">
              Unsaved changes
            </span>
          ) : savedAt ? (
            <span data-testid="saved-indicator" className="text-xs text-emerald-600">
              Saved
            </span>
          ) : null}
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end lg:w-auto">
          <div className="flex w-full items-center gap-1 overflow-x-auto rounded-md border border-border bg-muted/30 p-1 sm:w-auto" role="tablist" aria-label="Flow view" data-testid="flow-view-switcher">
            {(['canvas', 'yaml', 'side-by-side'] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={viewMode === mode ? 'default' : 'ghost'}
                className="h-8 px-2.5"
                role="tab"
                aria-selected={viewMode === mode}
                data-testid={`view-mode-${mode}`}
                data-active={String(viewMode === mode)}
                onClick={() => switchView(mode)}
              >
                {mode === 'canvas' ? 'Canvas' : mode === 'yaml' ? 'YAML' : 'Side by side'}
              </Button>
            ))}
          </div>
          <nav aria-label="Flow run navigation" className="flex w-full items-center sm:w-auto">
            <Button size="sm" variant="secondary" className="w-full justify-start sm:w-auto sm:justify-center" asChild>
              <Link
                to={`/console/flows/${encodeURIComponent(flowId)}/runs`}
                aria-label={`View run history for ${record?.name ?? flowId}`}
              >
                <History className="h-4 w-4" aria-hidden="true" />
                Run history
              </Link>
            </Button>
          </nav>
          <div
            className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end sm:border-l sm:border-border sm:pl-3"
            role="group"
            aria-label="Draft actions"
          >
            <Button size="sm" variant="ghost" className="flex-1 sm:flex-none" onClick={() => void revert()} disabled={saving || publishing}>
              Revert
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => void saveDraft()}
              disabled={saving || publishing}
              data-testid="save-draft-button"
            >
              {saving ? 'Saving…' : 'Save draft'}
            </Button>
            <Button
              size="sm"
              className="flex-1 sm:flex-none"
              onClick={() => void publish()}
              disabled={publishing || saving || blockingErrors > 0}
              title={blockingErrors > 0 ? 'Resolve the validation errors before publishing.' : undefined}
              data-testid="publish-button"
            >
              {publishing ? 'Publishing…' : 'Publish'}
            </Button>
          </div>
        </div>
      </header>
      {loadError && record !== null ? (
        <p className="border-b border-border bg-destructive/10 px-4 py-1 text-xs text-destructive">{loadError}</p>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 overflow-y-auto border-r border-border">
          <div className="px-3 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Task types
          </div>
          <FlowPalette workspaceId={workspaceId} onCatalogLoaded={setTaskTypes} />
        </aside>
        {/* View switcher: canvas, YAML, or both side by side. YAML is the canonical document;
            an invalid YAML edit keeps the canvas on its last-valid graph (degradation banner). */}
        {(viewMode === 'canvas' || viewMode === 'side-by-side') && renderCanvasSurface}
        {(viewMode === 'yaml' || viewMode === 'side-by-side') && renderYamlSurface}
        {selectedNode && viewMode !== 'yaml' ? (
          <aside className="w-72 shrink-0 overflow-y-auto border-l border-border">
            <NodePropertyPanel
              key={selectedNode.id}
              node={selectedNode}
              taskTypes={taskTypes}
              onChangeDsl={onChangeDsl}
            />
          </aside>
        ) : null}
      </div>
      <FlowProblemsPanel problems={allProblems} onSelectNode={selectNode} />
    </div>
  )
}

export function ConsoleFlowDesignerPage() {
  const { flowId } = useParams<{ flowId: string }>()
  const { activeWorkspaceId } = useConsoleContext()

  if (!flowId) {
    return <p className="p-6 text-sm text-muted-foreground">Missing flow identifier.</p>
  }
  if (!activeWorkspaceId) {
    return <p className="p-6 text-sm text-muted-foreground">Select a workspace to open the designer.</p>
  }

  return (
    <ReactFlowProvider>
      <DesignerSurface workspaceId={activeWorkspaceId} flowId={flowId} />
    </ReactFlowProvider>
  )
}
