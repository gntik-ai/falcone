import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ConsoleTimeRangeSelector } from './ConsoleTimeRangeSelector'

describe('ConsoleTimeRangeSelector', () => {
  it('permite cambiar de preset y mostrar campos custom', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ConsoleTimeRangeSelector value={{ preset: '24h' }} onChange={onChange} />)

    await user.selectOptions(screen.getByLabelText(/ventana de métricas/i), 'custom')
    expect(onChange).toHaveBeenCalled()
  })

  it('deshabilita el selector y explica cuando el rango no aplica', () => {
    const onChange = vi.fn()
    render(
      <ConsoleTimeRangeSelector
        value={{ preset: 'custom', from: '2026-01-01T00:00', to: '2026-01-02T00:00' }}
        onChange={onChange}
        disabled
        disabledReason="No aplica al scope tenant."
      />
    )

    const rangeSelect = screen.getByLabelText(/ventana de métricas/i)
    expect(screen.getByRole('group', { name: /rango temporal/i })).toHaveAttribute('aria-disabled', 'true')
    expect(rangeSelect).toBeDisabled()
    expect(rangeSelect).toHaveDisplayValue('Sin ventana activa')
    expect(rangeSelect).toHaveAccessibleDescription('No aplica al scope tenant.')
    expect(screen.getByLabelText(/desde/i)).toBeDisabled()
    expect(screen.getByLabelText(/hasta/i)).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('No aplica al scope tenant.')
    expect(onChange).not.toHaveBeenCalled()
  })
})
