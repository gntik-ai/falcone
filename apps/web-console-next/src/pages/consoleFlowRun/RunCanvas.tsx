// Read-only run-mode canvas (copied from the legacy RunCanvas, wrapped on kit panels).
//
// Reuses the DSL -> graph projection and renders every node through the single run node type.
// Nothing is draggable, connectable or editable. Click, Enter and Space select a node; the page
// decides what selecting means (open the inspector and move focus into it).
import { useCallback, useMemo, type KeyboardEvent } from 'react'
import { Background, Controls, ReactFlow, ReactFlowProvider, type AriaLabelConfig, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useTranslation } from 'react-i18next'
import { definitionToEdges, definitionToNodes } from './flowGraphModel'
import { runNodeTypes, type RunNodeData } from './RunNode'
import { formatDuration, nodeStatusTones, type NodeStatusSnapshot } from './status'
import type { FlowDefinition } from './flows'

export interface RunCanvasProps {
  definition: FlowDefinition
  nodeStatuses: Map<string, NodeStatusSnapshot>
  selectedNodeId: string | null
  onSelectNode: (nodeId: string, source: 'pointer' | 'keyboard') => void
  // Escape on a focused node while the inspector is open closes it.
  onEscape: () => boolean
}

function RunCanvasSurface({ definition, nodeStatuses, selectedNodeId, onSelectNode, onEscape }: RunCanvasProps) {
  const { t } = useTranslation('pages.console-flow-run-page')
  const nodes = useMemo<Node<RunNodeData>[]>(() => definitionToNodes(definition).map((node) => {
    const snapshot = nodeStatuses.get(node.id) ?? null
    const typeLabel = t(`nodeTypes.${node.type}`, { defaultValue: node.type })
    const statusLabel = snapshot ? t(`nodeStatus.${snapshot.status}`, { defaultValue: snapshot.status }) : t('nodePending')
    const duration = snapshot ? formatDuration(snapshot.startedAt, snapshot.completedAt) : null
    const detail = snapshot ? [snapshot.attemptNumber > 1 ? t('attemptNumber', { number: snapshot.attemptNumber }) : '', duration ?? ''].filter(Boolean).join(' · ') : ''
    const name = node.data.label === node.type ? typeLabel : node.data.label
    return {
      id: node.id, type: 'run', position: node.position, selectable: true, draggable: false, connectable: false, selected: node.id === selectedNodeId,
      ariaLabel: t('nodeNamed', { type: typeLabel, name, status: statusLabel }),
      domAttributes: { 'aria-description': t('nodeDescription') },
      data: {
        ...node.data, label: name, typeLabel, pendingLabel: t('nodePending'),
        status: snapshot ? { key: snapshot.status, label: statusLabel, tone: nodeStatusTones[snapshot.status] ?? 'neutral', detail } : null,
      },
    }
  }), [definition, nodeStatuses, selectedNodeId, t])
  const edges = useMemo<Edge[]>(() => definitionToEdges(definition).map((edge) => ({
    ...edge, selectable: false, ariaLabel: t('edgeNamed', { source: edge.source, target: edge.target }),
    label: edge.data?.kind === 'default' ? t('defaultConnection') : edge.label,
  })) as Edge[], [definition, t])
  const ariaLabelConfig: Partial<AriaLabelConfig> = {
    'node.a11yDescription.default': t('nodeDescription'),
    'node.a11yDescription.keyboardDisabled': t('nodeDescription'),
    'edge.a11yDescription.default': t('edgeDescription'),
    'controls.ariaLabel': t('controls.ariaLabel'),
    'handle.ariaLabel': t('handle.ariaLabel'),
    'controls.zoomIn.ariaLabel': t('zoomIn'), 'controls.zoomOut.ariaLabel': t('zoomOut'),
    'controls.fitView.ariaLabel': t('fitView'), 'controls.interactive.ariaLabel': t('toggleInteractive'),
  }
  // Enter and Space select like a click; they are handled in the capture phase so React Flow's
  // own selection handling does not also run. Escape never reaches an open alert-dialog because
  // dialogs render outside this subtree.
  const onKeyDown = useCallback((event: KeyboardEvent) => {
    const element = (event.target as HTMLElement).closest<HTMLElement>('.react-flow__node')
    if (!element?.dataset.id) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation()
      onSelectNode(element.dataset.id, 'keyboard')
    } else if (event.key === 'Escape' && onEscape()) {
      event.preventDefault(); event.stopPropagation()
    }
  }, [onSelectNode, onEscape])
  return <section className="run-canvas relative min-w-0 flex-1" aria-label={t('canvas')} data-testid="run-canvas" onKeyDownCapture={onKeyDown}>
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={runNodeTypes} nodesDraggable={false} nodesConnectable={false} elementsSelectable={true}
      onNodeClick={(_event, node) => onSelectNode(node.id, 'pointer')} ariaLabelConfig={ariaLabelConfig} fitView={true} proOptions={{ hideAttribution: true }}>
      <Background gap={16} /><Controls showInteractive={false} />
    </ReactFlow>
  </section>
}

export function RunCanvas(props: RunCanvasProps) {
  return <ReactFlowProvider><RunCanvasSurface {...props} /></ReactFlowProvider>
}

// Move focus back to a node after the inspector closes.
export function focusRunNode(root: ParentNode | null, nodeId: string) {
  const element = Array.from(root?.querySelectorAll<HTMLElement>('.react-flow__node') ?? []).find((item) => item.dataset.id === nodeId)
  element?.focus()
}
