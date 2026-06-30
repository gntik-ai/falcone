// bbx: graph <-> DSL round-trip + canvasMetadata persistence + error-badge rendering
// (change: add-console-flow-designer).
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  autoLayout,
  definitionToEdges,
  definitionToNodes,
  nodesToDefinition,
  readCanvasMetadata,
  writeCanvasMetadata
} from '@/components/flows/flowGraphModel'
import { NodeShell } from '@/components/flows/nodes/NodeShell'
import type { FlowDefinition } from '@/types/flows'

// task -> branch -> (task | task) fixture, matching the shared DSL contract shape.
function fixture(): FlowDefinition {
  return {
    apiVersion: 'v1.0',
    name: 'order-pipeline',
    nodes: [
      { id: 'start', type: 'task', taskType: 'http-request', input: { url: 'https://example.test' }, next: 'decide' },
      {
        id: 'decide',
        type: 'branch',
        arms: [
          { when: 'input.total > 100', next: 'notify' },
          { when: 'input.total <= 100', next: 'archive' }
        ]
      },
      { id: 'notify', type: 'task', taskType: 'send-email', retryPolicy: { maxAttempts: 3 } },
      { id: 'archive', type: 'task', taskType: 'postgres-query' }
    ],
    canvasMetadata: { nodes: { start: { x: 320, y: 140 } } }
  }
}

describe('flowGraphModel round-trip', () => {
  it('serialises canvas graph -> DSL -> canvas graph preserving node count and types', () => {
    const definition = fixture()
    const nodes = definitionToNodes(definition)
    const edges = definitionToEdges(definition)

    expect(nodes).toHaveLength(4)
    expect(nodes.map((node) => node.type)).toEqual(['task', 'branch', 'task', 'task'])
    // 1 next edge + 2 arm edges
    expect(edges).toHaveLength(3)

    const roundTripped = nodesToDefinition(definition, nodes, edges)
    expect(roundTripped.nodes).toHaveLength(4)
    expect(roundTripped.nodes.map((node) => node.type)).toEqual(['task', 'branch', 'task', 'task'])
    // Edge fields survive the round-trip.
    expect(roundTripped.nodes[0]).toMatchObject({ id: 'start', next: 'decide' })
    expect(roundTripped.nodes[1]).toMatchObject({
      arms: [
        { when: 'input.total > 100', next: 'notify' },
        { when: 'input.total <= 100', next: 'archive' }
      ]
    })
    // Non-edge payload survives untouched.
    expect(roundTripped.nodes[0]).toMatchObject({ taskType: 'http-request', input: { url: 'https://example.test' } })
    expect(roundTripped.nodes[2]).toMatchObject({ retryPolicy: { maxAttempts: 3 } })

    // A second projection from the round-tripped definition is stable.
    const nodesAgain = definitionToNodes(roundTripped)
    expect(nodesAgain.map((node) => ({ id: node.id, type: node.type }))).toEqual(
      nodes.map((node) => ({ id: node.id, type: node.type }))
    )
  })

  it('derives branch arm edges with per-arm source handles and labels', () => {
    const edges = definitionToEdges(fixture())
    const armEdges = edges.filter((edge) => edge.data?.kind === 'arm')
    expect(armEdges).toHaveLength(2)
    expect(armEdges[0]).toMatchObject({ source: 'decide', target: 'notify', sourceHandle: 'arm-0' })
    expect(armEdges[1]).toMatchObject({ source: 'decide', target: 'archive', sourceHandle: 'arm-1' })
  })
})

describe('empty draft definition projection', () => {
  it('projects a definition without nodes to an empty canvas node list', () => {
    expect(definitionToNodes({})).toEqual([])
  })

  it('projects a definition without nodes to an empty canvas edge list', () => {
    expect(definitionToEdges({})).toEqual([])
  })

  it('auto-layouts an absent node list to an empty position map', () => {
    expect(autoLayout(undefined)).toEqual({})
  })
})

describe('canvasMetadata persistence', () => {
  it('reads node positions from canvasMetadata.nodes', () => {
    expect(readCanvasMetadata(fixture())).toEqual({ start: { x: 320, y: 140 } })
  })

  it('writes the repositioned node into canvasMetadata.nodes on save projection', () => {
    const definition = fixture()
    const written = writeCanvasMetadata(definition, { start: { x: 320, y: 140 }, decide: { x: 12.5, y: 80 } })
    expect(written.canvasMetadata?.nodes).toEqual({
      start: { x: 320, y: 140 },
      decide: { x: 12.5, y: 80 }
    })
    // Execution semantics are untouched.
    expect(written.nodes).toEqual(definition.nodes)
  })

  it('applies a deterministic auto-layout when canvasMetadata is absent', () => {
    const definition = fixture()
    delete definition.canvasMetadata
    const nodes = definitionToNodes(definition)
    const layout = autoLayout(definition.nodes)
    for (const node of nodes) {
      expect(node.position).toEqual(layout[node.id])
    }
    // Distinct, vertically stacked positions.
    const ys = nodes.map((node) => node.position.y)
    expect(new Set(ys).size).toBe(nodes.length)
  })

  it('restores positions from canvasMetadata when present', () => {
    const nodes = definitionToNodes(fixture())
    const start = nodes.find((node) => node.id === 'start')
    expect(start?.position).toEqual({ x: 320, y: 140 })
  })
})

describe('NodeShell error badge', () => {
  it('renders an error badge with the error count when validationErrors is non-empty', () => {
    render(
      <NodeShell
        typeLabel="Task"
        label="send-email"
        validationErrors={[
          { code: 'FLW-E006', nodeId: 'notify', message: 'Unknown task type' },
          { code: 'FLW-E005', nodeId: 'notify', message: 'Bad expression' }
        ]}
        badges={['retry ×3']}
      />
    )
    expect(screen.getByTestId('flow-node-error-badge')).toHaveTextContent('2')
    expect(screen.getByTestId('flow-node-badge')).toHaveTextContent('retry ×3')
  })

  it('renders no error badge for a clean node', () => {
    render(<NodeShell typeLabel="Task" label="send-email" validationErrors={[]} />)
    expect(screen.queryByTestId('flow-node-error-badge')).toBeNull()
  })
})
