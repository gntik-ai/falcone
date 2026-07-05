import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RestoreSimulationDialog } from '../RestoreSimulationDialog'

function renderDialog(overrides: Partial<Parameters<typeof RestoreSimulationDialog>[0]> = {}) {
  const onLaunch = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()
  render(
    <RestoreSimulationDialog
      tenantId="tenant-1"
      componentType="postgresql"
      instanceId="pg-1"
      snapshotId="snap-1"
      onLaunch={onLaunch}
      onClose={onClose}
      {...overrides}
    />
  )
  return { onLaunch, onClose }
}

describe('RestoreSimulationDialog', () => {
  it('[#744] exposes the dialog with an accessible name from its title (aria-labelledby)', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: 'Simulación de restore' })).toBeInTheDocument()
  })

  it('[#744] Escape dismisses the dialog via onClose', () => {
    const { onClose } = renderDialog()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('launches the simulation with the drill body when confirmed', () => {
    const { onLaunch } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Lanzar simulación' }))
    expect(onLaunch).toHaveBeenCalledWith({
      tenant_id: 'tenant-1',
      component_type: 'postgresql',
      instance_id: 'pg-1',
      snapshot_id: 'snap-1',
      execution_mode: 'simulation',
    })
  })
})
