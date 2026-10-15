import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { App } from '../src/App'
import { changeLocale } from '../src/i18n'

test.each([
  ['es', 'Acerca de', 'Consola', 'Bienvenida', 'Esta página estará disponible próximamente.'],
  ['en', 'About', 'Console', 'Welcome', 'This page will be available soon.']
] as const)('shell and lazy welcome copy render in %s', async (locale, about, consoleName, title, body) => {
  await changeLocale(locale)
  render(<MemoryRouter><App /></MemoryRouter>)
  expect(screen.getByText(about)).toBeVisible()
  expect(screen.getByRole('img', { name: consoleName })).toBeVisible()
  expect(await screen.findByRole('heading', { name: title })).toBeVisible()
  expect(screen.getByText(body)).toBeVisible()
})

test('user menu changes the shell and route copy without navigation', async () => {
  render(<MemoryRouter initialEntries={['/console/overview']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Resumen' })).toBeVisible()
  fireEvent.click(screen.getByText('Menú de usuario'))
  fireEvent.change(screen.getByRole('combobox', { name: 'Idioma' }), { target: { value: 'en' } })
  expect(await screen.findByRole('heading', { name: 'Overview' })).toBeVisible()
  expect(screen.getByText('About')).toBeVisible()
  expect(document.documentElement.lang).toBe('en')
  expect(localStorage.getItem('falcone-next-locale')).toBe('en')
})

test('settings switch changes both controls and Intl samples', async () => {
  render(<MemoryRouter initialEntries={['/console/settings']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Página pendiente' })).toBeVisible()
  const controls = screen.getAllByRole('combobox', { name: 'Idioma', hidden: true })
  fireEvent.change(controls[1], { target: { value: 'en' } })
  expect(await screen.findByRole('heading', { name: 'Page pending' })).toBeVisible()
  expect(screen.getByText('1234.5')).toBeVisible()
  await waitFor(() => expect(screen.getAllByRole('combobox', { name: 'Language', hidden: true })).toHaveLength(2))
})

test.each([['es', 'Página no encontrada'], ['en', 'Page not found']] as const)('unknown routes render localized 404 in %s', async (locale, title) => {
  await changeLocale(locale)
  render(<MemoryRouter initialEntries={['/missing']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: title })).toBeVisible()
})
