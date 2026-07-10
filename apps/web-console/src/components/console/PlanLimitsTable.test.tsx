import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PlanLimitsTable } from './PlanLimitsTable'

const rows = [{ dimensionKey: 'requests', displayLabel: 'Requests', effectiveValue: -1, source: 'explicit' as const, unit: 'req' }]

describe('PlanLimitsTable', () => {
  it('renders unlimited and editable states', () => {
    const onResetRequest = vi.fn()
    render(<PlanLimitsTable dimensions={rows} editable onResetRequest={onResetRequest} />)
    expect(screen.getByLabelText(/requests: valor del límite/i)).toBeInTheDocument()
    expect(screen.getByText('Explícito')).toBeInTheDocument()
    expect(screen.getByText('Persistido')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /guardar límite de requests/i })).toBeDisabled()
    screen.getByRole('button', { name: /restablecer límite de requests al valor predeterminado/i }).click()
    expect(onResetRequest).toHaveBeenCalledWith(rows[0])
  })

  it('resets the visible input when refreshed dimensions change', async () => {
    const { rerender } = render(<PlanLimitsTable dimensions={[{ ...rows[0], effectiveValue: 10 }]} editable />)
    const input = screen.getByLabelText(/requests: valor del límite/i)

    await userEvent.clear(input)
    await userEvent.type(input, '1.5')
    expect(input).toHaveValue(1.5)

    rerender(<PlanLimitsTable dimensions={[{ ...rows[0], effectiveValue: 10 }]} editable />)
    expect(input).toHaveValue(10)
  })

  it('requires the explicit save affordance before submitting a draft edit', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    render(
      <PlanLimitsTable
        dimensions={[{ ...rows[0], effectiveValue: 10 }]}
        editable
        onUpdate={onUpdate}
      />
    )

    const input = screen.getByLabelText(/requests: valor del límite/i)
    await user.clear(input)
    await user.type(input, '12')
    expect(screen.getByText(/cambio sin guardar/i)).toBeInTheDocument()

    await user.tab()
    expect(onUpdate).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /guardar límite de requests/i }))
    expect(onUpdate).toHaveBeenCalledWith('requests', 12)
  })

  it('blocks decimal drafts locally and does not call update', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    render(
      <PlanLimitsTable
        dimensions={[{ ...rows[0], effectiveValue: 10 }]}
        editable
        onUpdate={onUpdate}
      />
    )

    const input = screen.getByLabelText(/requests: valor del límite/i)
    await user.clear(input)
    await user.type(input, '1.5')
    expect(input).toHaveValue(1.5)
    expect(screen.getAllByText(/usa -1 para indicar sin límite/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /guardar límite de requests/i })).toBeDisabled()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('does not submit a draft edit before a reset request', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const onResetRequest = vi.fn()

    render(
      <PlanLimitsTable
        dimensions={[{ ...rows[0], effectiveValue: 10 }]}
        editable
        onUpdate={onUpdate}
        onResetRequest={onResetRequest}
      />
    )

    const input = screen.getByLabelText(/requests: valor del límite/i)
    await user.clear(input)
    await user.type(input, '12')
    await user.click(screen.getByRole('button', { name: /restablecer límite de requests al valor predeterminado/i }))

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onResetRequest).toHaveBeenCalledWith({ ...rows[0], effectiveValue: 10 })
  })

  it('marks an empty draft invalid without submitting on blur', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    render(<PlanLimitsTable dimensions={[{ ...rows[0], effectiveValue: 10 }]} editable onUpdate={onUpdate} />)

    const input = screen.getByLabelText(/requests: valor del límite/i)
    await user.clear(input)
    await user.tab()

    expect(screen.getByText(/introduce -1/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /guardar límite de requests/i })).toBeDisabled()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('makes the busy row state explicit', () => {
    render(
      <PlanLimitsTable
        dimensions={[{ ...rows[0], effectiveValue: 10 }]}
        editable
        busyDimensionKey="requests"
        rowStatuses={{ requests: { state: 'saving', message: 'Restableciendo' } }}
      />
    )

    expect(screen.getByLabelText(/requests: valor del límite/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /guardando límite de requests/i })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/restableciendo/i)
  })
})
