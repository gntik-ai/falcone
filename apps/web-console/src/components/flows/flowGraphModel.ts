// Graph <-> DSL-model mapping (change: add-console-flow-designer).
//
// The single source of truth for translating between the @xyflow/react canvas representation
// (nodes + edges arrays) and the shared flow DSL (FlowDefinition.nodes). The mapping is
// LOSSLESS modulo canvasMetadata additions: load a fixture -> graph -> back to DSL deep-equals
// the original (positions are layered into canvasMetadata, never into execution semantics).
//
// Edge derivation mirrors the shared validator's `outgoingEdges` (flow-definition-validator.mjs):
//   task/wait/approval/sub-flow/sequence -> `next`
//   sequence                             -> `steps[]`  (kind: 'step')
//   parallel                             -> `branches[]`(kind: 'branch')  + `next`
//   branch                               -> `arms[].next` (kind: 'arm', per-arm sourceHandle)
//                                           `default`      (kind: 'default')
//
// Reconstructing the DSL from edges keeps the node payloads (taskType, retryPolicy, arm.when,
// flowId, duration…) on `node.data.dsl`, so a round-trip preserves every non-edge field.

import type {
  CanvasMetadata,
  FlowDefinition,
  FlowNode,
  ValidationError
} from '@/types/flows'

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
  definition: Pick<FlowDefinition, 'canvasMetadata'>
): Record<string, { x: number; y: number }> {
  const nodes = definition.canvasMetadata?.nodes
  if (!nodes || typeof nodes !== 'object') return {}
  const out: Record<string, { x: number; y: number }> = {}
  for (const [id, pos] of Object.entries(nodes)) {
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
      out[id] = { x: pos.x, y: pos.y }
    }
  }
  return out
}

// Merge the current canvas node positions into canvasMetadata.nodes, preserving any other
// (free-form) canvasMetadata keys verbatim.
export function writeCanvasMetadata(
  definition: FlowDefinition,
  positions: Record<string, { x: number; y: number }>
): FlowDefinition {
  const existing: CanvasMetadata = definition.canvasMetadata ?? {}
  const nodes: Record<string, { x: number; y: number }> = {}
  for (const [id, pos] of Object.entries(positions)) {
    nodes[id] = { x: pos.x, y: pos.y }
  }
  return {
    ...definition,
    canvasMetadata: { ...existing, nodes }
  }
}

// Apply a deterministic vertical auto-layout when canvasMetadata is absent.
export function autoLayout(nodes: FlowNode[]): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {}
  nodes.forEach((node, index) => {
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
  definition: FlowDefinition,
  errorsByNode: Map<string, ValidationError[]> = new Map()
): FlowCanvasNode[] {
  const positions = { ...autoLayout(definition.nodes), ...readCanvasMetadata(definition) }
  return definition.nodes.map((node) => ({
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
export function definitionToEdges(definition: FlowDefinition): FlowCanvasEdge[] {
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

  for (const node of definition.nodes) {
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

// Canvas (nodes + edges) -> DSL. Node payloads come from data.dsl; edge fields are
// reconstructed from the edges array so a designer move/connect is reflected in the DSL.
export function nodesToDefinition(
  base: FlowDefinition,
  nodes: FlowCanvasNode[],
  edges: FlowCanvasEdge[],
  positions?: Record<string, { x: number; y: number }>
): FlowDefinition {
  const edgesBySource = new Map<string, FlowCanvasEdge[]>()
  for (const edge of edges) {
    const list = edgesBySource.get(edge.source) ?? []
    list.push(edge)
    edgesBySource.set(edge.source, list)
  }

  const dslNodes: FlowNode[] = nodes.map((canvasNode) => {
    const dsl = canvasNode.data.dsl
    const outgoing = edgesBySource.get(canvasNode.id) ?? []
    return rebuildNodeEdges(dsl, outgoing)
  })

  const pos = positions ?? Object.fromEntries(nodes.map((n) => [n.id, n.position]))
  const withMetadata = writeCanvasMetadata({ ...base, nodes: dslNodes }, pos)
  return withMetadata
}

function rebuildNodeEdges(dsl: FlowNode, outgoing: FlowCanvasEdge[]): FlowNode {
  const nextEdge = outgoing.find((e) => e.data?.kind === 'next')
  switch (dsl.type) {
    case 'branch': {
      const armEdges = outgoing
        .filter((e) => e.data?.kind === 'arm')
        .sort((a, b) => (a.data?.armIndex ?? 0) - (b.data?.armIndex ?? 0))
      const defaultEdge = outgoing.find((e) => e.data?.kind === 'default')
      const arms = (dsl.arms ?? []).map((arm, index) => ({
        when: arm.when,
        next: armEdges.find((e) => (e.data?.armIndex ?? -1) === index)?.target ?? arm.next
      }))
      const rebuilt: FlowNode = { ...dsl, arms }
      if (defaultEdge) (rebuilt as { default?: string }).default = defaultEdge.target
      return rebuilt
    }
    case 'parallel': {
      const branchEdges = outgoing.filter((e) => e.data?.kind === 'branch')
      const rebuilt: FlowNode = {
        ...dsl,
        branches: branchEdges.length > 0 ? branchEdges.map((e) => e.target) : dsl.branches
      }
      if (nextEdge) rebuilt.next = nextEdge.target
      return rebuilt
    }
    case 'sequence': {
      const stepEdges = outgoing.filter((e) => e.data?.kind === 'step')
      const rebuilt: FlowNode = {
        ...dsl,
        steps: stepEdges.length > 0 ? stepEdges.map((e) => e.target) : dsl.steps
      }
      if (nextEdge) rebuilt.next = nextEdge.target
      return rebuilt
    }
    default: {
      const rebuilt: FlowNode = { ...dsl }
      if (nextEdge) rebuilt.next = nextEdge.target
      return rebuilt
    }
  }
}
