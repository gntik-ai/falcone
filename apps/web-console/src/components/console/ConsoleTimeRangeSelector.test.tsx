import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ConsoleTimeRangeSelector } from './ConsoleTimeRangeSelector'

describe('ConsoleTimeRangeSelector', () => {
  it('permite cambiar entre presets soportados sin ofrecer custom', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ConsoleTimeRangeSelector value={{ preset: '24h' }} onChange={onChange} />)

    const rangeSelect = screen.getByLabelText(/ventana de métricas/i) as HTMLSelectElement
    expect(Array.from(rangeSelect.options).map((option) => option.value)).toEqual(['24h', '7d', '30d'])
    expect(screen.queryByRole('option', { name: /custom/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/desde/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/hasta/i)).not.toBeInTheDocument()

    await user.selectOptions(rangeSelect, '7d')
    expect(onChange).toHaveBeenCalledWith({ preset: '7d' })
  })

  it('deshabilita el selector y explica cuando el rango no aplica', () => {
    const onChange = vi.fn()
    render(
      <ConsoleTimeRangeSelector
        value={{ preset: '24h' }}
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
    expect(screen.queryByLabelText(/desde/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/hasta/i)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('No aplica al scope tenant.')
    expect(onChange).not.toHaveBeenCalled()
  })
})
