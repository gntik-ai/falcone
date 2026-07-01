// Interaction-time connection rules for the flow canvas (change: add-console-flow-designer).
//
// Enforced synchronously inside @xyflow/react's `isValidConnection` callback so an illegal
// edge is never committed to the graph (design.md D3). The rules mirror the DSL semantics:
//   - no self-loop (a node's output may not feed its own input),
//   - acyclicity (FLW-E002): adding source->target must not make source reachable from target,
//   - branch-arm arity: a branch node's condition-arm handle (and its default handle)
//     carries at most ONE outgoing edge,
//   - single-next arity: node types whose DSL has a single `next` field (task, wait,
//     approval, sub-flow) carry at most one outgoing edge, so no edge is silently lost
//     when the graph is projected back to the DSL.

import type { FlowCanvasEdge, FlowCanvasNode } from '@/components/flows/flowGraphModel'

export interface ConnectionAttempt {
  source: string | null
  target: string | null
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface ConnectionVerdict {
  ok: boolean
  // Stable rule identifier: 'FLW-E002' for cycles, designer-local codes otherwise.
  code?: 'FLW-E002' | 'SELF_LOOP' | 'BRANCH_ARM_ARITY' | 'NEXT_ARITY' | 'INCOMPLETE'
  message?: string
}

const SINGLE_NEXT_TYPES = new Set(['task', 'wait', 'approval', 'sub-flow'])

// BFS over the current edges: is `goal` reachable from `start`?
function isReachable(start: string, goal: string, edges: FlowCanvasEdge[]): boolean {
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const list = adjacency.get(edge.source) ?? []
    list.push(edge.target)
    adjacency.set(edge.source, list)
  }
  const queue = [start]
  const visited = new Set<string>([start])
  while (queue.length > 0) {
    const current = queue.shift() as string
    if (current === goal) return true
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next)
        queue.push(next)
      }
    }
  }
  return false
}

// Full verdict with the violated rule, for the Problems panel message.
export function evaluateConnection(
  connection: ConnectionAttempt,
  nodes: FlowCanvasNode[],
  edges: FlowCanvasEdge[]
): ConnectionVerdict {
  const { source, target } = connection
  if (!source || !target) {
    return { ok: false, code: 'INCOMPLETE', message: 'La conexión debe tener un nodo origen y un nodo destino.' }
  }

  if (source === target) {
    return {
      ok: false,
      code: 'SELF_LOOP',
      message: `El nodo "${source}" no puede conectarse consigo mismo.`
    }
  }

  // Acyclicity (FLW-E002): after adding source->target the graph has a cycle exactly
  // when source is already reachable from target.
  if (isReachable(target, source, edges)) {
    return {
      ok: false,
      code: 'FLW-E002',
      message: `Conectar "${source}" con "${target}" crearía un ciclo; el grafo de nodos debe ser acíclico (FLW-E002).`
    }
  }

  const sourceNode = nodes.find((node) => node.id === source)
  const sourceHandle = connection.sourceHandle ?? null

  // Branch-arm arity: one outgoing edge per condition-arm handle (and per default handle).
  if (sourceNode?.type === 'branch' && sourceHandle) {
    const occupied = edges.some(
      (edge) => edge.source === source && (edge.sourceHandle ?? null) === sourceHandle
    )
    if (occupied) {
      return {
        ok: false,
        code: 'BRANCH_ARM_ARITY',
        message: `El handle de rama "${sourceHandle}" del nodo "${source}" ya tiene una conexión saliente.`
      }
    }
  }

  // Single-next arity: the DSL has a single `next` for these node types.
  if (sourceNode && SINGLE_NEXT_TYPES.has(sourceNode.type)) {
    const occupied = edges.some((edge) => edge.source === source)
    if (occupied) {
      return {
        ok: false,
        code: 'NEXT_ARITY',
        message: `El nodo "${source}" ya tiene una conexión saliente; su tipo ("${sourceNode.type}") admite un solo siguiente paso.`
      }
    }
  }

  return { ok: true }
}

// Boolean form for @xyflow/react's `isValidConnection` prop.
export function isValidConnection(
  connection: ConnectionAttempt,
  nodes: FlowCanvasNode[],
  edges: FlowCanvasEdge[]
): boolean {
  return evaluateConnection(connection, nodes, edges).ok
}
