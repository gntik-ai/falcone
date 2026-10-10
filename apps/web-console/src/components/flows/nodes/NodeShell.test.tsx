import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { NodeShell } from './NodeShell'

describe('NodeShell validation tooltips', () => {
  it('localizes server errors while preserving the code and node ID', () => {
    render(<NodeShell typeLabel="Tarea" label="dup" validationErrors={[
      { code: 'FLW-E001', nodeId: 'dup', message: 'Duplicate node ID "dup"', params: { nodeId: 'dup' } }
    ]} />)
    expect(screen.getByTestId('flow-node-error-badge')).toHaveAttribute('title',
      'FLW-E001: ID de nodo duplicado "dup"; los ID de nodo deben ser únicos dentro del flujo.')
  })
})
