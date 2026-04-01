import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RestoreConfirmationDialog } from '../RestoreConfirmationDialog'
import type { InitiateRestoreResponse } from '@/services/backupOperationsApi'

const response: InitiateRestoreResponse = {
  schema_version: '2',
  confirmation_token: 'token',
  confirmation_request_id: 'req-1',
  expires_at: '2026-04-01T09:30:00Z',
  ttl_seconds: 300,
  risk_level: 'normal',
  available_second_factors: [],
  prechecks: [],
  warnings: [],
  target: {
    tenant_id: 'tenant-1',
    tenant_name: 'Tenant ABC',
    component_type: 'postgresql',
    instance_id: 'pg-1',
    snapshot_id: 'snap-1',
    snapshot_created_at: '2026-04-01T08:00:00Z',
    snapshot_age_hours: 1,
  },
}

describe('RestoreConfirmationDialog', () => {
  it('enables confirm only with exact tenant name', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onAbort = vi.fn().mockResolvedValue(undefined)
    render(<RestoreConfirmationDialog precheckResponse={response} onConfirm={onConfirm} onAbort={onAbort} isConfirming={false} />)

    const button = screen.getByRole('button', { name: 'Confirmar restauración' })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Tenant name confirmation'), { target: { value: 'tenant abc' } })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Tenant name confirmation'), { target: { value: 'Tenant ABC' } })
    expect(button).toBeEnabled()
  })
})
