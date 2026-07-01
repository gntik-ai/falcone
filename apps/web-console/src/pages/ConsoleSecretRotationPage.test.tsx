import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  initiateRotation: vi.fn().mockResolvedValue({ rotationId: 'r1', vaultVersionNew: 2, gracePeriodSeconds: 1800 }),
  listRotationHistory: vi.fn().mockResolvedValue({ items: [{ eventType: 'initiated', actorId: 'u1' }], total: 1 }),
  getConsumerStatus: vi.fn().mockResolvedValue({ consumers: [{ consumer_id: 'apisix', reload_mechanism: 'api_reload', state: 'confirmed' }] })
}))

vi.mock('@/actions/secretRotationActions', () => ({
  initiateRotation: mocks.initiateRotation,
  listRotationHistory: mocks.listRotationHistory,
  getConsumerStatus: mocks.getConsumerStatus
}))

import { ConsoleSecretRotationPage } from './ConsoleSecretRotationPage'

describe('ConsoleSecretRotationPage', () => {
  it('renders rotation form and submits', async () => {
    render(
      <MemoryRouter initialEntries={['/console/secrets/platform%2Fpostgresql%2Fapp-password/rotate']}>
        <Routes>
          <Route path="/console/secrets/:encodedSecretPath/rotate" element={<ConsoleSecretRotationPage />} />
        </Routes>
      </MemoryRouter>
    )

    fireEvent.change(screen.getByLabelText('Entrada de periodo de gracia'), { target: { value: '900' } })
    fireEvent.change(screen.getByLabelText('Justificación'), { target: { value: 'planned rotation' } })
    fireEvent.change(screen.getByLabelText('Valor nuevo'), { target: { value: 'ciphertext' } })
    fireEvent.click(screen.getByText('Enviar rotación'))

    await waitFor(() => expect(mocks.initiateRotation).toHaveBeenCalledWith('platform/postgresql/app-password', {
      gracePeriodSeconds: 900,
      justification: 'planned rotation',
      newValue: 'ciphertext'
    }))
  })

  it('renders consumer status', async () => {
    render(
      <MemoryRouter initialEntries={['/console/secrets/platform%2Fpostgresql%2Fapp-password/rotate']}>
        <Routes>
          <Route path="/console/secrets/:encodedSecretPath/rotate" element={<ConsoleSecretRotationPage />} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByText('apisix')).toBeInTheDocument())
  })
})
