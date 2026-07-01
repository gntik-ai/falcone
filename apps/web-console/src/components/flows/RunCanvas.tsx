// Read-only run-mode canvas (change: add-console-flow-monitoring / #366).
//
// Reuses the designer's DSL→graph projection (flowGraphModel.ts) but renders every node through
// the single RunNode type with its run-status badge overlay, and disables all editing (no drag,
// no connect, no edit) per the spec "The canvas SHALL be non-interactive while in run mode".
// Selecting a node calls onSelectNode so the run page opens the detail panel.
import { useMemo } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { definitionToEdges, definitionToNodes } from '@/components/flows/flowGraphModel'
import { runNodeTypes, type RunNodeData } from '@/components/flows/nodes/RunNode'
import type { FlowDefinition } from '@/types/flows'
import type { NodeStatusSnapshot } from '@/lib/hooks/use-flow-execution'

const TYPE_LABELS: Record<string, string> = {
  task: 'Tarea',
  branch: 'Rama',
  parallel: 'Paralelo',
  wait: 'Espera',
  approval: 'Aprobación',
  'sub-flow': 'Subflujo',
  sequence: 'Secuencia'
}

export interface RunCanvasProps {
  definition: FlowDefinition
  nodeStatuses: Map<string, NodeStatusSnapshot>
  selectedNodeId?: string | null
  onSelectNode?: (nodeId: string) => void
}

function RunCanvasSurface({ definition, nodeStatuses, selectedNodeId, onSelectNode }: RunCanvasProps) {
  const nodes = useMemo<Node<RunNodeData>[]>(() => {
    const projected = definitionToNodes(definition)
    return projected.map((node) => ({
      id: node.id,
      type: 'run',
      position: node.position,
      selectable: true,
      draggable: false,
      connectable: false,
      selected: node.id === selectedNodeId,
      data: {
        ...node.data,
        typeLabel: TYPE_LABELS[node.type] ?? node.type,
        runStatus: nodeStatuses.get(node.id) ?? null
      }
    }))
  }, [definition, nodeStatuses, selectedNodeId])

  const edges = useMemo<Edge[]>(
    () => definitionToEdges(definition).map((edge) => ({ ...edge, selectable: false })) as Edge[],
    [definition]
  )

  return (
    <div className="min-h-[420px] min-w-0 flex-1" data-testid="run-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={runNodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_event, node) => onSelectNode?.(node.id)}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

export function RunCanvas(props: RunCanvasProps) {
  return (
    <ReactFlowProvider>
      <RunCanvasSurface {...props} />
    </ReactFlowProvider>
  )
}
