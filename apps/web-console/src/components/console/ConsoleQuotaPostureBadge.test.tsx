import { render, screen } from '@testing-library/react'
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
})
