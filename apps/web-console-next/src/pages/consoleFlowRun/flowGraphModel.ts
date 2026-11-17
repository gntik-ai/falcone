// DSL -> canvas projection for the read-only run view (copied from the designer's flowGraphModel).
//
// Only the node and edge projection is kept: a run canvas never writes positions or edges back.
// Edge derivation mirrors the shared validator's outgoingEdges.

import type {
  FlowDefinition,
  FlowNode,
  ValidationError
} from './flows'

export interface FlowCanvasNodeData {
  // The full DSL node minus the edge fields that are reconstructed from canvas edges.
  dsl: FlowNode
  label: string
  validationErrors: ValidationError[]
  [key: string]: unknown
}

export interface FlowCanvasNode {
  id: string
  type: FlowNode['type']
  position: { x: number; y: number }
  data: FlowCanvasNodeData
}

export type FlowEdgeKind = 'next' | 'step' | 'branch' | 'arm' | 'default'

export interface FlowCanvasEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  label?: string
  data?: { kind: FlowEdgeKind; armIndex?: number }
}

const AUTO_LAYOUT_X = 240
const AUTO_LAYOUT_Y_SPACING = 140
const AUTO_LAYOUT_Y_START = 80

function nodeLabel(node: FlowNode): string {
  if (node.name && node.name.trim()) return node.name
  if (node.type === 'task') return node.taskType
  if (node.type === 'sub-flow') return `${node.flowId}@${node.flowVersion}`
  return node.type
}

// Read positions out of canvasMetadata.nodes (the DV-free round-trip channel).
export function readCanvasMetadata(
  definition: Pick<Partial<FlowDefinition>, 'canvasMetadata'> | undefined
): Record<string, { x: number; y: number }> {
  const nodes = definition?.canvasMetadata?.nodes
  if (!nodes || typeof nodes !== 'object') return {}
  const out: Record<string, { x: number; y: number }> = {}
  for (const [id, pos] of Object.entries(nodes)) {
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
      out[id] = { x: pos.x, y: pos.y }
    }
  }
  return out
}

// Apply a deterministic vertical auto-layout when canvasMetadata is absent.
export function autoLayout(nodes: FlowNode[] | undefined): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {}
  ;(nodes ?? []).forEach((node, index) => {
    out[node.id] = { x: AUTO_LAYOUT_X, y: AUTO_LAYOUT_Y_START + index * AUTO_LAYOUT_Y_SPACING }
  })
  return out
}

// Strip the edge-defining fields from a DSL node; what remains is carried on data.dsl so a
// round-trip can re-attach edges without losing node payload.
function stripEdgeFields(node: FlowNode): FlowNode {
  return node
}

// DSL -> canvas nodes. Positions come from canvasMetadata (falling back to auto-layout).
export function definitionToNodes(
  definition: Partial<FlowDefinition> | undefined,
  errorsByNode: Map<string, ValidationError[]> = new Map()
): FlowCanvasNode[] {
  // Fresh drafts may arrive as `definition: {}`; project missing nodes as an empty canvas.
  const nodes = definition && Array.isArray(definition.nodes) ? definition.nodes : []
  const positions = { ...autoLayout(nodes), ...readCanvasMetadata(definition) }
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: positions[node.id] ?? { x: AUTO_LAYOUT_X, y: AUTO_LAYOUT_Y_START },
    data: {
      dsl: stripEdgeFields(node),
      label: nodeLabel(node),
      validationErrors: errorsByNode.get(node.id) ?? []
    }
  }))
}

// DSL -> canvas edges, mirroring the validator's outgoingEdges so the canvas graph is the
// SAME graph the acyclicity/reference rules run over.
export function definitionToEdges(definition: Partial<FlowDefinition> | undefined): FlowCanvasEdge[] {
  const edges: FlowCanvasEdge[] = []
  const push = (
    source: string,
    target: string,
    kind: FlowEdgeKind,
    extra: { sourceHandle?: string; label?: string; armIndex?: number } = {}
  ) => {
    if (typeof target !== 'string' || target.length === 0) return
    edges.push({
      id: `${source}__${extra.sourceHandle ?? kind}__${target}`,
      source,
      target,
      sourceHandle: extra.sourceHandle ?? null,
      label: extra.label,
      data: { kind, armIndex: extra.armIndex }
    })
  }

  // Fresh drafts may arrive as `definition: {}`; project missing nodes as an empty canvas.
  for (const node of definition && Array.isArray(definition.nodes) ? definition.nodes : []) {
    switch (node.type) {
      case 'sequence':
        for (const step of node.steps ?? []) push(node.id, step, 'step')
        if (node.next) push(node.id, node.next, 'next')
        break
      case 'parallel':
        for (const branch of node.branches ?? []) push(node.id, branch, 'branch')
        if (node.next) push(node.id, node.next, 'next')
        break
      case 'branch':
        (node.arms ?? []).forEach((arm, armIndex) =>
          push(node.id, arm.next, 'arm', { sourceHandle: `arm-${armIndex}`, label: arm.when, armIndex })
        )
        if (node.default) push(node.id, node.default, 'default', { sourceHandle: 'default', label: 'default' })
        break
      default:
        if (node.next) push(node.id, node.next, 'next')
        break
    }
  }
  return edges
}
