import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ReconciliationDelta } from '@/lib/reconcile-operations'

import { OperationStatusBanner } from './OperationStatusBanner'

function delta(partial: Partial<ReconciliationDelta> = {}): ReconciliationDelta {
  return {
    updated: [],
    added: [],
    terminal: [],
    unavailable: [],
    unchanged: [],
    ...partial
  }
}

afterEach(() => {
  cleanup()
})

const baseOperation = {
  operationId: 'op-1',
  status: 'failed' as const,
  operationType: 'workspace.create',
  tenantId: 'tenant-a',
  workspaceId: 'wrk-a',
  actorId: 'usr-1',
  actorType: 'tenant_owner',
  createdAt: '2026-03-30T10:00:00.000Z',
  updatedAt: '2026-03-30T10:00:00.000Z',
  correlationId: 'corr-op-1'
}

describe('OperationStatusBanner', () => {
  it('renders consolidated terminal delta', () => {
    render(<OperationStatusBanner delta={delta({ terminal: [baseOperation] })} />)
    expect(screen.getByRole('status')).toHaveTextContent('falló mientras estabas desconectado')
  })

  it('renders unavailable summary', () => {
    render(<OperationStatusBanner delta={delta({ unavailable: ['op-1'] })} />)
    expect(screen.getByRole('status')).toHaveTextContent('ya no está disponible')
  })

  it('dismisses when button is clicked', () => {
    const onDismiss = vi.fn()
    render(<OperationStatusBanner delta={delta({ terminal: [baseOperation] })} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('renders nothing for empty delta', () => {
    const { container } = render(<OperationStatusBanner delta={delta()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
