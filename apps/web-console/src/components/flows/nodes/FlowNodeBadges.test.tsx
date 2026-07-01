import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { BranchNode } from '@/components/flows/nodes/BranchNode'
import { ParallelNode } from '@/components/flows/nodes/ParallelNode'

vi.mock('@xyflow/react', () => ({
  Handle: ({ id }: { id?: string }) => <span data-testid="react-flow-handle" data-handle-id={id ?? ''} />,
  Position: {
    Bottom: 'bottom',
    Right: 'right',
    Top: 'top'
  }
}))

describe('flow node badges', () => {
  it('renders branch arm counts in Spanish with singular and plural forms', () => {
    const renderBranch = (arms: Array<{ when: string; next: string }>) =>
      render(
        <BranchNode
          {...({
            id: 'decision',
            data: {
              dsl: { id: 'decision', type: 'branch', arms },
              label: 'decision',
              validationErrors: []
            },
            selected: false
          } as unknown as Parameters<typeof BranchNode>[0])}
        />
      )

    const { rerender } = renderBranch([{ when: 'input.total > 100', next: 'approve' }])
    expect(screen.getByTestId('flow-node-badge')).toHaveTextContent('1 brazo')

    rerender(
      <BranchNode
        {...({
          id: 'decision',
          data: {
            dsl: {
              id: 'decision',
              type: 'branch',
              arms: [
                { when: 'input.total > 100', next: 'approve' },
                { when: 'input.total <= 100', next: 'archive' }
              ]
            },
            label: 'decision',
            validationErrors: []
          },
          selected: false
        } as unknown as Parameters<typeof BranchNode>[0])}
      />
    )
    expect(screen.getByTestId('flow-node-badge')).toHaveTextContent('2 brazos')
  })

  it('renders parallel branch counts in Spanish with singular and plural forms', () => {
    const renderParallel = (branches: string[]) =>
      render(
        <ParallelNode
          {...({
            id: 'fanout',
            data: {
              dsl: { id: 'fanout', type: 'parallel', branches },
              label: 'fanout',
              validationErrors: []
            },
            selected: false
          } as unknown as Parameters<typeof ParallelNode>[0])}
        />
      )

    const { rerender } = renderParallel(['enrich-email'])
    expect(screen.getByTestId('flow-node-badge')).toHaveTextContent('1 rama')

    rerender(
      <ParallelNode
        {...({
          id: 'fanout',
          data: {
            dsl: { id: 'fanout', type: 'parallel', branches: ['enrich-email', 'enrich-phone'] },
            label: 'fanout',
            validationErrors: []
          },
          selected: false
        } as unknown as Parameters<typeof ParallelNode>[0])}
      />
    )
    expect(screen.getByTestId('flow-node-badge')).toHaveTextContent('2 ramas')
  })
})
