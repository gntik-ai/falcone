import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ConsoleQuotaPostureBadge } from './ConsoleQuotaPostureBadge'

describe('ConsoleQuotaPostureBadge', () => {
  it('renderiza variantes conocidas y desconocidas', () => {
    const { rerender } = render(<ConsoleQuotaPostureBadge posture="within_limit" />)
    expect(screen.getByText('Dentro del límite')).toBeInTheDocument()

    rerender(<ConsoleQuotaPostureBadge posture="warning_threshold_reached" />)
    expect(screen.getByText('Umbral de advertencia')).toBeInTheDocument()

    rerender(<ConsoleQuotaPostureBadge posture="mystery_state" />)
    expect(screen.getByText('mystery state')).toBeInTheDocument()
  })

  it('sin linkTo, no requiere contexto de router (comportamiento previo intacto)', () => {
    render(<ConsoleQuotaPostureBadge posture="within_limit" />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('[#766] con linkTo, envuelve la insignia en un enlace de navegación hacia Cuotas', () => {
    render(<ConsoleQuotaPostureBadge posture="hard_limit_breached" linkTo="/console/quotas" />, { wrapper: MemoryRouter })
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/console/quotas')
    expect(link).toHaveTextContent('Límite duro superado')
  })
})
