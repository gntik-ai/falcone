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

import { CapabilityGate } from '@/components/console/CapabilityGate'
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

  // Client-side semantic validation (FLW-E001…FLW-E009) on every graph change.
  const semanticErrors = useMemo(
    () =>
      validateFlowSemantics(currentDefinition, {
        taskTypeCatalog: taskTypes.length > 0 ? taskTypes.map((descriptor) => descriptor.id) : undefined
      }),
    [currentDefinition, taskTypes]
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

  const saveDraft = useCallback(async (): Promise<boolean> => {
    setSaving(true)
    setLoadError(null)
    try {
      const saved = await updateFlowDraft(workspaceId, flowId, { definition: currentDefinition })
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
  }, [workspaceId, flowId, currentDefinition, applyServerRejection])

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

  const blockingErrors = semanticErrors.length + serverErrors.length

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
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <Link className="text-sm text-muted-foreground hover:underline" to="/console/flows">
            Flows
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-semibold">{record?.name ?? flowId}</span>
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
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => void revert()} disabled={saving || publishing}>
            Revert
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void saveDraft()}
            disabled={saving || publishing}
            data-testid="save-draft-button"
          >
            {saving ? 'Saving…' : 'Save draft'}
          </Button>
          <Button
            size="sm"
            onClick={() => void publish()}
            disabled={publishing || saving || blockingErrors > 0}
            title={blockingErrors > 0 ? 'Resolve the validation errors before publishing.' : undefined}
            data-testid="publish-button"
          >
            {publishing ? 'Publishing…' : 'Publish'}
          </Button>
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
        {selectedNode ? (
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
    <CapabilityGate capability="workflows" mode="disable">
      <ReactFlowProvider>
        <DesignerSurface workspaceId={activeWorkspaceId} flowId={flowId} />
      </ReactFlowProvider>
    </CapabilityGate>
  )
}
