import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'

import { App } from '../src/App'

test('the root displays the Falcone brand, activates dark mode and provides live announcements', () => {
  const { container } = render(<MemoryRouter><App /></MemoryRouter>)

  expect(screen.getByText('Falcone')).toBeVisible()
  expect(screen.getByRole('img', { name: 'Falcone' })).toBeInTheDocument()
  expect(document.documentElement).toHaveClass('dark')
  expect(document.documentElement).toHaveAttribute('data-brand', 'falcone')
  expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument()
  expect(container.querySelector('[aria-live="assertive"]')).toBeInTheDocument()
})
