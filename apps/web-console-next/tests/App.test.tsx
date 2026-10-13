import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { App } from '../src/App'

test('the app root shows the Falcone brand, active dark theme and live announcements', () => {
  window.history.replaceState(null, '', import.meta.env.BASE_URL)
  const { container } = render(<App />)
  expect(screen.getByText('Falcone')).toBeVisible()
  expect(document.documentElement).toHaveClass('dark')
  expect(document.documentElement.style.colorScheme).toBe('dark')
  expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument()
  expect(container.querySelector('[aria-live="assertive"]')).toBeInTheDocument()
})

test.each([
  ['/next', '/next/console/overview'],
  ['/', '/console/overview']
])('the browser router renders overview with basename %s', (basename, path) => {
  window.history.replaceState(null, '', path)
  render(<App basename={basename} />)
  expect(screen.getByRole('heading', { name: 'Resumen' })).toBeVisible()
})

test('the default browser basename matches the Vite build base', () => {
  const base = import.meta.env.BASE_URL
  window.history.replaceState(null, '', `${base}console/overview`)
  render(<App />)
  expect(screen.getByRole('heading', { name: 'Resumen' })).toBeVisible()
})
