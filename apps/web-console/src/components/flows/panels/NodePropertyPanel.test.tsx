import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { FlowCanvasNode } from '@/components/flows/flowGraphModel'
import type { FlowNode } from '@/types/flows'

import { NodePropertyPanel } from './NodePropertyPanel'

afterEach(() => cleanup())

function canvasNode(dsl: FlowNode): FlowCanvasNode {
  return {
    id: dsl.id,
    type: dsl.type,
    position: { x: 0, y: 0 },
    data: {
      dsl,
      label: dsl.name ?? dsl.id,
      validationErrors: []
    }
  }
}

describe('NodePropertyPanel', () => {
  it('renders localized branch, approval and sub-flow copy', () => {
    const onChangeDsl = vi.fn()
    const { rerender } = render(
      <NodePropertyPanel
        node={canvasNode({ id: 'branch-1', type: 'branch', arms: [{ when: '$.ok', next: 'task-1' }] })}
        taskTypes={[]}
        onChangeDsl={onChangeDsl}
      />
    )

    expect(screen.getByText(/conexión predeterminada/i)).toBeInTheDocument()
    expect(screen.getByText('(expresión)')).toBeInTheDocument()
    expect(screen.queryByText('(expression)')).not.toBeInTheDocument()

    rerender(
      <NodePropertyPanel
        node={canvasNode({ id: 'approval-1', type: 'approval', approvers: ['ops'], timeout: 'P1D' })}
        taskTypes={[]}
        onChangeDsl={onChangeDsl}
      />
    )
    expect(screen.getByLabelText('Tiempo de espera (ISO 8601)')).toBeInTheDocument()

    rerender(
      <NodePropertyPanel
        node={canvasNode({ id: 'subflow-1', type: 'sub-flow', flowId: 'child-flow', flowVersion: 'v1' })}
        taskTypes={[]}
        onChangeDsl={onChangeDsl}
      />
    )
    expect(screen.getByLabelText('ID del flujo')).toBeInTheDocument()
    expect(screen.getByLabelText('Versión del flujo')).toBeInTheDocument()
  })
})
