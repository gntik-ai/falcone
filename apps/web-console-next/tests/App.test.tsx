import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'

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

test('the console header renders a bundled inline SVG icon', () => {
  render(<MemoryRouter><App /></MemoryRouter>)
  const icon = screen.getByRole('img', { name: 'Consola' })
  expect(icon.tagName.toLowerCase()).toBe('svg')
  expect(icon).toBeVisible()
})

test('the shell About entry shows the release version and seven-character image SHA', () => {
  vi.stubGlobal('__APP_VERSION__', '1.2.3')
  vi.stubGlobal('__APP_COMMIT_SHA__', '0123456789abcdef0123456789abcdef01234567')
  render(<MemoryRouter><App /></MemoryRouter>)
  fireEvent.click(screen.getByText('Acerca de'))
  expect(screen.getByText('1.2.3 · 0123456')).toBeVisible()
})

test('the shell About entry shows dev without a SHA for local builds', () => {
  render(<MemoryRouter><App /></MemoryRouter>)
  fireEvent.click(screen.getByText('Acerca de'))
  expect(screen.getByText('dev')).toBeVisible()
  expect(screen.queryByText(/ · /)).not.toBeInTheDocument()
})
