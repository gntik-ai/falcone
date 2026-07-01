import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PlanLimitsTable } from './PlanLimitsTable'

const rows = [{ dimensionKey: 'requests', displayLabel: 'Requests', effectiveValue: -1, source: 'explicit' as const, unit: 'req' }]

describe('PlanLimitsTable', () => {
  it('renders unlimited and editable states', () => {
    const onRemove = vi.fn()
    render(<PlanLimitsTable dimensions={rows} editable onRemove={onRemove} />)
    expect(screen.getByLabelText(/requests: valor del límite/i)).toBeInTheDocument()
    screen.getByRole('button', { name: /restablecer límite de requests al valor predeterminado/i }).click()
    expect(onRemove).toHaveBeenCalledWith('requests')
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

  it('does not submit a draft edit before a pointer reset', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const onRemove = vi.fn()

    render(
      <PlanLimitsTable
        dimensions={[{ ...rows[0], effectiveValue: 10 }]}
        editable
        onUpdate={onUpdate}
        onRemove={onRemove}
      />
    )

    const input = screen.getByLabelText(/requests: valor del límite/i)
    await user.clear(input)
    await user.type(input, '12')
    await user.click(screen.getByRole('button', { name: /restablecer límite de requests al valor predeterminado/i }))

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onRemove).toHaveBeenCalledWith('requests')
  })

  it('does not submit a draft edit when keyboard focus moves to reset before activation', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const onRemove = vi.fn()

    render(
      <PlanLimitsTable
        dimensions={[{ ...rows[0], effectiveValue: 10 }]}
        editable
        onUpdate={onUpdate}
        onRemove={onRemove}
      />
    )

    const input = screen.getByLabelText(/requests: valor del límite/i)
    await user.clear(input)
    await user.type(input, '12')
    await user.tab()

    const resetButton = screen.getByRole('button', { name: /restablecer límite de requests al valor predeterminado/i })
    expect(resetButton).toHaveFocus()
    expect(onUpdate).not.toHaveBeenCalled()

    await user.keyboard('{Enter}')

    expect(onUpdate).not.toHaveBeenCalled()
    expect(onRemove).toHaveBeenCalledWith('requests')
  })

  it('submits a keyboard draft when focus leaves reset without activation', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const onRemove = vi.fn()

    render(
      <PlanLimitsTable
        dimensions={[{ ...rows[0], effectiveValue: 10 }]}
        editable
        onUpdate={onUpdate}
        onRemove={onRemove}
      />
    )

    const input = screen.getByLabelText(/requests: valor del límite/i)
    await user.clear(input)
    await user.type(input, '12')
    await user.tab()
    await user.tab()

    expect(onRemove).not.toHaveBeenCalled()
    expect(onUpdate).toHaveBeenCalledWith('requests', 12)
  })

  it('restores the persisted value when an empty draft loses focus', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    render(<PlanLimitsTable dimensions={[{ ...rows[0], effectiveValue: 10 }]} editable onUpdate={onUpdate} />)

    const input = screen.getByLabelText(/requests: valor del límite/i)
    await user.clear(input)
    await user.tab()

    expect(onUpdate).not.toHaveBeenCalled()
    expect(input).toHaveValue(10)
  })

  it('makes the busy row state explicit', () => {
    render(<PlanLimitsTable dimensions={[{ ...rows[0], effectiveValue: 10 }]} editable busyDimensionKey="requests" />)

    expect(screen.getByLabelText(/requests: valor del límite/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /guardando límite de requests/i })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/guardando límite de requests/i)
  })
})
