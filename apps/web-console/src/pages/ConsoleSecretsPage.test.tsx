import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { revokeSecretVersionMock } = vi.hoisted(() => ({
  revokeSecretVersionMock: vi.fn().mockResolvedValue({ revokedVersion: 1, effectiveAt: '2026-03-31T00:00:00.000Z' })
}))
vi.mock('@/actions/secretRotationActions', () => ({ revokeSecretVersion: revokeSecretVersionMock }))

import { ConsoleSecretsPage, SecretVersionBadge } from './ConsoleSecretsPage'

describe('ConsoleSecretsPage', () => {
  it('renders secrets table', () => {
    render(<MemoryRouter><ConsoleSecretsPage /></MemoryRouter>)
    // Relabeled to disambiguate from the new Workspace Secrets screen (#723).
    expect(screen.getByText('Rotación de secretos')).toBeInTheDocument()
    expect(screen.getByText('app-password')).toBeInTheDocument()
  })

  it('renders badge styles per state', () => {
    const { container } = render(<SecretVersionBadge state="active" />)
    expect(container.textContent).toContain('active')
  })

  it('opens revoke dialog', () => {
    render(<MemoryRouter><ConsoleSecretsPage /></MemoryRouter>)
    fireEvent.click(screen.getAllByText('Revocar')[0])
    expect(screen.getByText('Revocar versión del secreto')).toBeInTheDocument()
  })

  // #757: this page previously rendered a `bg-white` card — a hard-coded light-mode panel on the
  // dark console theme — and a hand-rolled <table>. It must converge on the shared Card/Table
  // primitives like every other data-plane screen.
  it('uses the shared Card/Table primitives — no bg-white panel', () => {
    const { container } = render(<MemoryRouter><ConsoleSecretsPage /></MemoryRouter>)

    expect(container.querySelector('[data-slot="card"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="table"]')).toBeInTheDocument()

    const whiteBackgrounds = Array.from(container.querySelectorAll('[class*="bg-white"]'))
    expect(whiteBackgrounds).toHaveLength(0)
  })

  // Round-3 review fix (#757): the "Forzar revocación" checkbox was a raw <input type="checkbox">
  // bypassing the existing shared Checkbox primitive — the one remaining native/unstyled control
  // on this screen. Pin that it renders via Checkbox and preserves its checked-state behavior.
  it('renders the "Forzar revocación" checkbox via the shared Checkbox primitive and preserves its behavior (#757 round 3)', async () => {
    render(<MemoryRouter><ConsoleSecretsPage /></MemoryRouter>)

    fireEvent.click(screen.getAllByText('Revocar')[0])
    expect(await screen.findByText('Revocar versión del secreto')).toBeInTheDocument()

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.className).toMatch(/rounded border border-input/)
    expect(checkbox.checked).toBe(false)

    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)

    fireEvent.click(screen.getByText('Confirmar revocación'))
    expect(revokeSecretVersionMock).toHaveBeenCalledWith(
      'platform/postgresql/app-password',
      2,
      expect.objectContaining({ forceRevoke: true })
    )
  })
})
