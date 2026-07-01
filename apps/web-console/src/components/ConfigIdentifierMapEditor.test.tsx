import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConfigIdentifierMapEditor } from './ConfigIdentifierMapEditor'

describe('ConfigIdentifierMapEditor', () => {
  it('muestra el encabezado de alcance en español y conserva los valores técnicos scope', () => {
    render(
      <ConfigIdentifierMapEditor
        entries={[{ scope: 'tenant', from: 'source-tenant-id', to: 'target-tenant-id' }]}
        onChange={vi.fn()}
      />
    )

    const scopeHeader = screen.getByRole('columnheader', { name: 'Alcance' })
    expect(scopeHeader).toHaveAttribute('scope', 'col')
    expect(screen.queryByRole('columnheader', { name: 'Scope' })).not.toBeInTheDocument()
    expect(screen.getByText('tenant')).toBeInTheDocument()
    expect(screen.getByDisplayValue('target-tenant-id')).toBeInTheDocument()
  })
})
