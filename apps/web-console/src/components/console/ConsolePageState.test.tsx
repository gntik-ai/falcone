import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConsolePageState } from './ConsolePageState'

afterEach(cleanup)

describe('ConsolePageState', () => {
  it('[#774] renders an optional icon without changing the labelled page-state semantics', () => {
    render(
      <ConsolePageState
        kind="empty"
        title="Sin datos"
        description="No hay datos para mostrar."
        icon={<span data-testid="custom-page-state-icon" />}
      />
    )

    const state = screen.getByRole('status', { name: /sin datos/i })
    expect(within(state).getByTestId('custom-page-state-icon')).toBeInTheDocument()
    expect(state).toHaveTextContent(/no hay datos para mostrar/i)
  })
})
